"""Local, deterministic weekly planning; no model or network calls."""
import re
from collections import Counter
from copy import deepcopy
from datetime import date, timedelta
from hashlib import sha256

from AI.validate_recipe import find_non_vegetarian_ingredients, ingredient_mentioned
from core import audit_meals, scale_ingredients, stock_available

MEAL_TYPES = ("breakfast", "lunch", "dinner")


class PlanningError(ValueError):
    pass


def slot_key(meal):
    return meal["meal_date"], meal["meal_type"]


def ordered_slots(start):
    return [((start + timedelta(days=offset)).isoformat(), kind)
            for offset in range(7) for kind in MEAL_TYPES]


# Dietary values are kept compatible with Family Management's stored values.
# "eggitarian" is the saved API value; the UI displays "Eggetarian".
_DIET_RANK = {"any": 0, "non-vegetarian": 0, "eggitarian": 1,
              "vegetarian": 2, "vegan": 3}
_ANIMAL_PRODUCTS = (
    "milk", "buttermilk", "paneer", "cheese", "butter", "ghee",
    "curd", "yogurt", "yoghurt", "cream", "whey", "casein",
    "honey", "mayonnaise", "albumen", "lard", "tallow",
)


def diet_compatible(ingredients, food_type):
    """Conservative ingredient-name filter (not an allergy guarantee)."""
    food_type = food_type or "any"
    if food_type in ("any", "non-vegetarian"):
        return True
    if food_type not in _DIET_RANK:
        return False
    non_veg = set(find_non_vegetarian_ingredients(ingredients))
    if food_type == "eggitarian":
        # Eggs are allowed, but fish/meat/gelatin are not.
        return not (non_veg - {"egg"})
    if non_veg:
        return False
    if food_type == "vegetarian":
        return not any(ingredient_mentioned(" ".join(map(str, ingredients)).casefold(), x)
                       for x in ("mayonnaise", "albumen", "lard", "tallow"))
    if food_type == "vegan":
        for item in ingredients:
            ingredient = str(item).casefold().strip()
            # Always reject honey and other animal additives even if a
            # plant-based substitute is mentioned elsewhere in the text.
            if any(ingredient_mentioned(ingredient, x)
                   for x in ("honey", "gelatin", "lard", "tallow", "casein", "whey")):
                return False
            if re.match(r"^(?:almond|soy|soya|oat|coconut|rice|cashew|vegan|plant[- ]based)\s+"
                        r"(?:milk|cheese|butter|cream|yogurt|yoghurt)\b", ingredient):
                continue
            if any(ingredient_mentioned(ingredient, x) for x in _ANIMAL_PRODUCTS):
                return False
        return True
    return False


def eligible(recipe, kind, preferences):
    if recipe["category"].strip().casefold() != kind:
        return False
    ingredients = [item[0] for item in recipe["ingredients"]]
    if not diet_compatible(ingredients, preferences.get("food_type", "any")):
        return False
    text = " ".join(ingredients).casefold()
    if any(ingredient_mentioned(text, item) for item in preferences.get("exclude", [])):
        return False
    limit = preferences.get("max_minutes")
    if limit is not None and (not recipe.get("minutes") or recipe["minutes"] > limit):
        return False
    return bool(ingredients) and recipe["base_servings"] > 0


NUTRIENTS = {
    "calories": "calories_per_serving",
    "protein_g": "protein_g_per_serving",
    "carbs_g": "carbs_g_per_serving",
    "fat_g": "fat_g_per_serving",
}


def nutrition_per_serving(recipe):
    """Return only known per-serving values; unknown macros are None."""
    result = {}
    for key, column in NUTRIENTS.items():
        value = recipe.get(column)
        result[key] = round(float(value), 1) if value is not None and (key != "calories" or float(value) > 0) else None
    result["source"] = recipe.get("nutrition_source") or ("illustrative" if result["calories"] is not None else "unknown")
    return result


def summarize_nutrition(meals):
    """Sum per-serving meals, never multiply by household size for a person's intake."""
    days = {}
    for meal in meals:
        day = days.setdefault(meal["meal_date"], {"date": meal["meal_date"], "known": 0, "meals": 0,
                                                  "nutrition": {key: 0.0 for key in NUTRIENTS},
                                                  "missing": {key: 0 for key in NUTRIENTS}})
        day["meals"] += 1
        info = meal.get("nutrition") or {}
        if info.get("calories") is not None:
            day["known"] += 1
        for key in NUTRIENTS:
            value = info.get(key)
            if value is None:
                day["missing"][key] += 1
            else:
                day["nutrition"][key] += value
    return [{"date": day["date"], "known_meals": day["known"], "total_meals": day["meals"],
             "per_person_if_attending_all": {
                 key: round(day["nutrition"][key], 1) if day["missing"][key] == 0 else None
                 for key in NUTRIENTS},
             "missing_meals": day["missing"]}
            for day in days.values()]


def has_real_leftovers(recipe, stock, meal_day, today):
    """Never auto-schedule predicted leftovers, especially on future dates."""
    if "leftovers" not in [str(t).casefold() for t in recipe.get("tags", [])] \
       and "leftover" not in recipe.get("name", "").casefold():
        return True
    if meal_day != today.isoformat():
        return False
    required = {name.casefold() for name, _, _ in recipe["ingredients"]}
    return any(item.get("is_leftover") and item.get("name", "").casefold() in required
               and stock_available(item, today=today) and float(item.get("quantity") or 0) > 0
               for item in stock)


def urgent_stock(stock, today):
    """Keep only dated purchases expiring soon; audit_meals checks their safety."""
    result = deepcopy(stock)
    deadline = (today + timedelta(days=3)).isoformat()
    for item in result:
        if item.get("batches"):
            item["batches"] = [batch for batch in item["batches"]
                               if batch.get("expiry_date") and batch["expiry_date"] <= deadline]
            # A zero sentinel prevents the audit's legacy fallback from counting
            # the ingredient summary when no urgent purchase remains.
            if not item["batches"]:
                item["batches"] = [{"quantity": 0, "expiry_date": None}]
        elif not item.get("expiry_date") or item["expiry_date"] > deadline:
            item["quantity"] = 0
            item["usable_quantity"] = 0
    return result


def coverage(candidate, prefix, recipes, stock, today):
    audit = audit_meals(prefix + [candidate], recipes, stock, today=today)
    deficits = {warning["ingredient"].casefold(): warning["missing"]
                for warning in audit["warnings"]
                if (warning["date"], warning["meal_type"]) == slot_key(candidate)}
    needs = scale_ingredients(recipes[candidate["recipe_id"]], candidate["eaters"])
    return sum(max(0, 1 - deficits.get(need["name"].casefold(), 0) / need["quantity"])
               for need in needs if need["quantity"] > 0) / max(1, len(needs))


def choose_recipe(pool, candidate, prefix, all_meals, recipes, stock, urgent, seed, today,
                  exclude_id=None):
    choices = [recipe for recipe in pool if recipe["id"] != exclude_id]
    if not choices:
        raise PlanningError("No alternative recipe fits this meal and the selected preferences.")
    counts = Counter(meal["recipe_id"] for meal in all_meals)
    # Keep category repetition balanced, even when stock strongly favors one dish.
    least = min(counts[recipe["id"]] for recipe in choices)
    choices = [recipe for recipe in choices if counts[recipe["id"]] == least]
    previous = next((meal for meal in reversed(prefix)
                     if meal["meal_type"] == candidate["meal_type"]), None)
    non_repeating = [recipe for recipe in choices
                     if previous is None or recipe["id"] != previous["recipe_id"]]
    choices = non_repeating or choices

    def score(recipe):
        trial = {**candidate, "recipe_id": recipe["id"]}
        available = coverage(trial, prefix, recipes, stock, today)
        freshness = coverage(trial, prefix, recipes, urgent, today)
        speed = 1 - min(recipe.get("minutes") or 240, 240) / 240
        tie = int(sha256(f"{seed}:{slot_key(candidate)}:{recipe['id']}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        fitness = 0
        nutritional = nutrition_per_serving(recipe)
        goal = candidate.get("nutrition_goal", "balanced")
        if goal == "high_protein" and nutritional["protein_g"] is not None:
            fitness += min(nutritional["protein_g"], 60) * 2.0
        if goal == "calorie_aware" and nutritional["calories"] is not None:
            per_day = candidate.get("daily_calorie_target")
            if per_day:
                proportions = {"breakfast": .25, "lunch": .4, "dinner": .35}
                target = per_day * proportions[candidate["meal_type"]]
                fitness += max(0, 85 - 85 * abs(nutritional["calories"] - target) / max(200, target))
        if goal == "balanced" and nutritional["protein_g"] is not None:
            fitness += min(10, nutritional["protein_g"] * .22)
        return available * 80 + freshness * 20 + speed * 5 + fitness + tie * 4, -recipe["id"]

    return max(choices, key=score)


def describe(meal, recipes):
    recipe = recipes[meal["recipe_id"]]
    return {**meal, "recipe_name": recipe["name"], "minutes": recipe["minutes"],
            "category": recipe["category"], "locked": bool(meal.get("completed_at")),
            "nutrition": nutrition_per_serving(recipe)}


def generate_week(start, recipes_data, stock, existing, household_size, preferences, seed=0,
                  today=None, eaters_for_slot=None, preferences_for_slot=None,
                  pinned_meals=None):
    """Generate using optional date/meal attendance and dietary resolvers."""
    today = today or date.today()
    recipes = {recipe["id"]: recipe for recipe in recipes_data}
    if not recipes:
        raise PlanningError("Your recipe library is empty. Add recipes before generating a week.")
    saved = {slot_key(meal): meal for meal in existing}
    pinned_meals = pinned_meals or {}
    # Day-specific limits may be less restrictive than the global limit.
    # Build base pools without a global cooking-time restriction in that case.
    base_preferences = dict(preferences)
    if preferences.get("weekday_minutes") is not None or preferences.get("weekend_minutes") is not None:
        base_preferences["max_minutes"] = None
    pools = {kind: [recipe for recipe in recipes_data if eligible(recipe, kind, base_preferences)]
             for kind in MEAL_TYPES}
    notices = []
    for kind, pool in pools.items():
        required = sum(1 for day, slot in ordered_slots(start)
                       if slot == kind and not saved.get((day, slot), {}).get("completed_at"))
        if required and not pool:
            raise PlanningError(f"No {kind} recipes fit these preferences. Adjust filters or add recipes.")
        if required > len(pool):
            notices.append(f"Only {len(pool)} eligible {kind} recipes for {required} open slots; some dishes repeat.")
    urgent = urgent_stock(stock, today)
    result = []
    for day, kind in ordered_slots(start):
        previous = saved.get((day, kind))
        if previous and previous.get("completed_at"):
            result.append(describe(dict(previous), recipes))
            continue
        eaters = eaters_for_slot(day, kind) if eaters_for_slot else household_size
        locked = pinned_meals.get((day, kind))
        if locked:
            if int(locked["eaters"]) != int(eaters):
                raise PlanningError("Attendance changed for a locked meal. Refresh your preview.")
            result.append(describe(dict(locked), recipes))
            continue
        slot_preferences = preferences_for_slot(day, kind) if preferences_for_slot else preferences
        candidate = {"meal_date": day, "meal_type": kind, "eaters": eaters, "completed_at": None,
                     "nutrition_goal": preferences.get("nutrition_goal", "balanced"),
                     "daily_calorie_target": preferences.get("daily_calorie_target")}
        slot_pool = [recipe for recipe in pools[kind]
                     if eligible(recipe, kind, slot_preferences)
                     and has_real_leftovers(recipe, stock, day, today)]
        if not slot_pool:
            raise PlanningError(
                f"No {kind} recipes satisfy all attending family members on {day}. "
                "Try a different diet selection or add suitable recipes."
            )
        chosen = choose_recipe(slot_pool, candidate, result, result, recipes, stock,
                               urgent, seed, today)
        described = describe({**candidate, "recipe_id": chosen["id"]}, recipes)
        try:
            pantry_fraction = coverage({**candidate, "recipe_id": chosen["id"]}, result, recipes, stock, today)
            urgent_fraction = coverage({**candidate, "recipe_id": chosen["id"]}, result, recipes, urgent, today)
        except (KeyError, ValueError, ZeroDivisionError):
            pantry_fraction = urgent_fraction = 0
        why = []
        if pantry_fraction > 0:
            why.append(f"Uses {round(pantry_fraction * 100)}% of required ingredient types from tracked Pantry stock")
        if urgent_fraction > 0:
            why.append("Includes available ingredients approaching their recorded date")
        if preferences.get("nutrition_goal") == "high_protein" and described["nutrition"]["protein_g"] is not None:
            why.append(f"{described['nutrition']['protein_g']:g} g protein per serving (recorded value)")
        if not why:
            why.append("Fits the selected meal type, dietary filters and available recipe library")
        described["why"] = why
        result.append(described)
    if any(meal.get("completed_at") for meal in result):
        notices.append("Cooked meals are kept exactly as saved; new preferences apply only to open slots.")
    if preferences.get("weekly_budget") is not None:
        notices.append("Weekly budget is advisory until ingredient prices are available; no unverified cost claim is made.")
    if preferences.get("nutrition_goal") in ("high_protein", "calorie_aware") and any(
        m["nutrition"]["protein_g" if preferences.get("nutrition_goal") == "high_protein" else "calories"] is None
        for m in result):
        notices.append("Some recipes have missing nutrition values; fitness ranking is partial until you enter reviewed values.")
    return {"meals": result, "notices": notices, "daily_nutrition": summarize_nutrition(result),
            "audit": audit_meals(result, recipes, stock, today=today)}


def replace_meal(start, meals, target, recipes_data, stock, preferences, seed=0, today=None):
    today = today or date.today()
    recipes = {recipe["id"]: recipe for recipe in recipes_data}
    index = next((index for index, meal in enumerate(meals) if slot_key(meal) == target), None)
    if index is None:
        raise PlanningError("The selected meal is outside this preview.")
    current = meals[index]
    if current.get("completed_at"):
        raise PlanningError("Cooked meals cannot be replaced.")
    slot_preferences = preferences.get("_slot_preferences", {}).get(
        (current["meal_date"], current["meal_type"]), preferences
    )
    pool = [recipe for recipe in recipes_data
            if eligible(recipe, current["meal_type"], slot_preferences)
            and has_real_leftovers(recipe, stock, current["meal_date"], today)]
    chosen = choose_recipe(pool, current, meals[:index], meals[:index] + meals[index + 1:], recipes,
                           stock, urgent_stock(stock, today), seed, today, exclude_id=current["recipe_id"])
    result = [describe(dict(meal), recipes) for meal in meals]
    result[index] = describe({**current, "recipe_id": chosen["id"]}, recipes)
    return {"meals": result, "daily_nutrition": summarize_nutrition(result),
            "audit": audit_meals(result, recipes, stock, today=today)}
