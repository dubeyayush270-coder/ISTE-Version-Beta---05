"""Preview-only suggestions and an atomic, conflict-checked weekly plan save."""
from datetime import date
from hashlib import sha256
import json
import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StrictBool

from db import connection
from family_management import attendance_for_slot, family_state
from weekly_planner import PlanningError, eligible, generate_week, ordered_slots, replace_meal, slot_key, summarize_nutrition, describe

router = APIRouter(prefix="/api/plan", tags=["Weekly planning"])


class Preferences(BaseModel):
    food_type: Literal["any", "vegetarian", "vegan", "non-vegetarian", "eggitarian"] = "any"
    exclude: list[str] = Field(default_factory=list, max_length=30)
    max_minutes: int | None = Field(default=None, ge=1, le=240)
    weekday_minutes: int | None = Field(default=None, ge=1, le=240)
    weekend_minutes: int | None = Field(default=None, ge=1, le=240)
    nutrition_goal: Literal["balanced", "high_protein", "calorie_aware"] = "balanced"
    daily_calorie_target: int | None = Field(default=None, ge=800, le=5000)
    weekly_budget: float | None = Field(default=None, gt=0, le=1000000)


class WeekRequest(BaseModel):
    start: date
    preferences: Preferences = Field(default_factory=Preferences)
    seed: int = Field(default=0, ge=0, le=1_000_000_000)


class SuggestedMeal(BaseModel):
    meal_date: date
    meal_type: Literal["breakfast", "lunch", "dinner"]
    recipe_id: int
    eaters: int = Field(ge=1, le=30)


class PreviewRequest(WeekRequest):
    meals: list[SuggestedMeal] = Field(min_length=21, max_length=21)
    expected_version: str = Field(min_length=64, max_length=64)


class ReplaceRequest(PreviewRequest):
    target_date: date
    target_type: Literal["breakfast", "lunch", "dinner"]


class LockSlot(BaseModel):
    meal_date: date
    meal_type: Literal["breakfast", "lunch", "dinner"]


class RegenerateRequest(PreviewRequest):
    locked_slots: list[LockSlot] = Field(default_factory=list, max_length=21)


class SaveRequest(PreviewRequest):
    confirmed: StrictBool = False
    replace_existing: StrictBool = False


# Family Management is the authoritative source when attendance is enabled.
# The default household setting is preserved when family attendance is off.
_DIET_RANK = {"any": 0, "non-vegetarian": 0, "eggitarian": 1,
              "vegetarian": 2, "vegan": 3}


def slot_context(c, day, kind, size, preferences):
    """Return effective servings and the strictest attending dietary choice."""
    result = {"eaters": size, "preferences": dict(preferences)}
    # A day-specific time limit supersedes the generic cooking-time filter.
    weekday = date.fromisoformat(day).weekday()
    specific = preferences.get("weekend_minutes") if weekday >= 5 else preferences.get("weekday_minutes")
    if specific is not None:
        result["preferences"]["max_minutes"] = specific
    if not family_state(c)["attendance_enabled"]:
        return result
    slot = attendance_for_slot(c, date.fromisoformat(day), kind)
    ids = slot["selected_member_ids"]
    if not ids:
        # The existing database requires one or more eaters per planned meal.
        # Never silently turn zero attendees into a phantom serving.
        raise PlanningError(
            f"No one is attending {kind} on {day}. "
            "Select an attendee in Family Management before generating all 21 meals."
        )
    slots = ",".join("?" for _ in ids)
    member_diets = [row[0] for row in c.execute(
        f"SELECT dietary_preference FROM family_members WHERE enabled=1 AND id IN ({slots})", ids
    )]
    requested = result["preferences"].get("food_type", "any")
    chosen = requested
    for member_diet in member_diets:
        if _DIET_RANK.get(member_diet, -1) < 0:
            raise PlanningError("An attending family member has an unknown dietary preference.")
        if _DIET_RANK[member_diet] > _DIET_RANK.get(chosen, 0):
            chosen = member_diet
    result["eaters"] = len(ids)
    result["preferences"]["food_type"] = chosen
    return result


def validate_family_preview(c, meals, existing, recipes, size, preferences):
    """Check current attendance and diet again for Replace and Save requests."""
    # Always revalidate day-wise time and global dietary filters, even in legacy mode.
    attendance_enabled = family_state(c)["attendance_enabled"]
    completed = {(m["meal_date"], m["meal_type"])
                 for m in existing if m.get("completed_at")}
    slot_preferences = {}
    for meal in meals:
        key = (meal["meal_date"], meal["meal_type"])
        if key in completed:
            continue  # History and already-deducted meals are immutable.
        try:
            context = slot_context(c, *key, size, preferences)
        except PlanningError as error:
            raise HTTPException(409, str(error)) from error
        slot_preferences[key] = context["preferences"]
        if attendance_enabled and int(meal["eaters"]) != int(context["eaters"]):
            raise HTTPException(409,
                f"Family attendance changed for {key[0]} {key[1]}. Generate a fresh preview.")
        recipe = recipes.get(meal["recipe_id"]) if isinstance(recipes, dict) else next(
            (r for r in recipes if r["id"] == meal["recipe_id"]), None
        )
        if not recipe or not eligible(recipe, key[1], context["preferences"]):
            raise HTTPException(409,
                f"Dietary filters or cooking-time preferences conflict with {key[0]} {key[1]}. Generate a fresh preview.")
    # The existing replace_meal() uses this to choose a valid alternative.
    preferences["_slot_preferences"] = slot_preferences


def attendance_is_enabled():
    with connection() as c:
        return family_state(c)["attendance_enabled"]


def helpers():
    # Import after app startup to avoid a circular import; shared calculations
    # and recipe/plan formats remain owned by the existing application.
    from app import plans, planning_stock, recipe_list, stock_list
    return plans, planning_stock, recipe_list, stock_list


def settings_size(c):
    return c.execute("SELECT household_size FROM settings WHERE id=1").fetchone()[0]


def version(existing, household_size):
    rows = [{key: meal.get(key) for key in
             ("id", "meal_date", "meal_type", "recipe_id", "eaters", "completed_at")}
            for meal in existing]
    rows.sort(key=slot_key)
    return sha256(json.dumps([household_size, rows], sort_keys=True).encode()).hexdigest()


def preferences_dict(data):
    preferences = data.preferences.model_dump()
    if any(not item.strip() or len(item) > 80 for item in preferences["exclude"]):
        raise HTTPException(422, "Each excluded ingredient must contain 1–80 characters.")
    preferences["exclude"] = [item.strip() for item in preferences["exclude"]]
    return preferences


def week_slots(start):
    try:
        return ordered_slots(start)
    except OverflowError:
        raise HTTPException(422, "The selected week is outside the supported date range.")


def load(c, start):
    plans, planning_stock, recipe_list, stock_list = helpers()
    existing = plans(c, start, 7)
    size = settings_size(c)
    return existing, size, recipe_list(c), planning_stock(stock_list(c), c), version(existing, size)


def normalized_meals(data, existing, recipes, preferences):
    slots = week_slots(data.start)
    incoming = [{**meal.model_dump(), "meal_date": meal.meal_date.isoformat(), "completed_at": None}
                for meal in data.meals]
    if len({slot_key(meal) for meal in incoming}) != 21 or {slot_key(meal) for meal in incoming} != set(slots):
        raise HTTPException(422, "Supply exactly one breakfast, lunch and dinner for each day of this week.")
    by_recipe = {recipe["id"]: recipe for recipe in recipes}
    saved = {slot_key(meal): meal for meal in existing}
    for meal in incoming:
        old = saved.get(slot_key(meal))
        recipe = by_recipe.get(meal["recipe_id"])
        if recipe is None:
            raise HTTPException(422, "A suggested recipe no longer exists. Generate a new preview.")
        if old and old.get("completed_at"):
            if (meal["recipe_id"], meal["eaters"]) != (old["recipe_id"], old["eaters"]):
                raise HTTPException(409, "Cooked meals cannot be replaced or resized.")
            meal["completed_at"] = old["completed_at"]
        else:
            general = dict(preferences)
            # Exact weekday/weekend limits are validated separately per slot.
            if general.get("weekday_minutes") is not None or general.get("weekend_minutes") is not None:
                general["max_minutes"] = None
            if not eligible(recipe, meal["meal_type"], general):
                raise HTTPException(422, "A suggested meal conflicts with its category or selected dietary preferences.")
    return sorted(incoming, key=lambda meal: slots.index(slot_key(meal)))


@router.post("/suggestions")
def suggest_week(data: WeekRequest):
    week_slots(data.start)
    preferences = preferences_dict(data)
    with connection() as c:
        c.execute("BEGIN")
        existing, size, recipes, stock, current_version = load(c, data.start)
        try:
            result = generate_week(
                data.start, recipes, stock, existing, size, preferences, data.seed,
                eaters_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["eaters"],
                preferences_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["preferences"],
            )
        except PlanningError as error:
            raise HTTPException(422, str(error))
    return {**result, "start": data.start.isoformat(), "expected_version": current_version,
            "existing_count": len(existing), "replace_count": sum(not meal.get("completed_at") for meal in existing),
            "household_size": size, "attendance_enabled": attendance_is_enabled(), "mode": "local-smart-planning"}




@router.post("/suggestions/regenerate")
def regenerate_unlocked(data: RegenerateRequest):
    """Regenerate all unlocked slots, preserving user pins and cooked meals; preview only."""
    week_slots(data.start)
    preferences = preferences_dict(data)
    with connection() as c:
        c.execute("BEGIN")
        existing, size, recipes, stock, current_version = load(c, data.start)
        if current_version != data.expected_version:
            raise HTTPException(409, "The saved week changed. Generate a new preview before regenerating.")
        incoming = normalized_meals(data, existing, recipes, preferences)
        validate_family_preview(c, incoming, existing, recipes, size, preferences)
        locked_keys = [(entry.meal_date.isoformat(), entry.meal_type) for entry in data.locked_slots]
        if len(set(locked_keys)) != len(locked_keys):
            raise HTTPException(422, "Duplicate locked meal entries")
        pinned = {slot_key(meal): meal for meal in incoming if slot_key(meal) in locked_keys}
        try:
            result = generate_week(data.start, recipes, stock, existing, size, preferences,
                                   data.seed,
                                   eaters_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["eaters"],
                                   preferences_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["preferences"],
                                   pinned_meals=pinned)
        except PlanningError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {**result, "start": data.start.isoformat(), "expected_version": current_version,
            "existing_count": len(existing),
            "replace_count": sum(not meal.get("completed_at") for meal in existing),
            "household_size": size, "attendance_enabled": attendance_is_enabled(),
            "mode": "local-smart-planning"}


@router.post("/suggestions/replace")
def replace_suggestion(data: ReplaceRequest):
    week_slots(data.start)
    preferences = preferences_dict(data)
    with connection() as c:
        c.execute("BEGIN")
        existing, size, recipes, stock, current_version = load(c, data.start)
        if current_version != data.expected_version:
            raise HTTPException(409, "The saved plan or household size changed. Generate a fresh preview.")
        incoming = normalized_meals(data, existing, recipes, preferences)
        validate_family_preview(c, incoming, existing, recipes, size, preferences)
        try:
            result = replace_meal(data.start, incoming, (data.target_date.isoformat(), data.target_type),
                                  recipes, stock, preferences, data.seed)
        except PlanningError as error:
            raise HTTPException(422, str(error))
    return result


@router.put("/week")
def save_week(data: SaveRequest):
    if not data.confirmed:
        raise HTTPException(422, "Review and confirm this weekly plan before saving.")
    week_slots(data.start)
    preferences = preferences_dict(data)
    try:
        with connection() as c:
            c.execute("BEGIN IMMEDIATE")
            existing, size, recipes, stock, current_version = load(c, data.start)
            if current_version != data.expected_version:
                raise HTTPException(409, "The saved plan or household size changed. Nothing was saved; generate a fresh preview.")
            incoming = normalized_meals(data, existing, recipes, preferences)
            validate_family_preview(c, incoming, existing, recipes, size, preferences)
            changes_existing = any(not old.get("completed_at") and
                                   (old["recipe_id"], old["eaters"]) != (meal["recipe_id"], meal["eaters"])
                                   for old in existing for meal in incoming if slot_key(old) == slot_key(meal))
            if changes_existing and not data.replace_existing:
                raise HTTPException(422, "Confirm replacement of the existing meal selections before saving.")
            kept = 0
            for meal in incoming:
                if meal.get("completed_at"):
                    kept += 1
                    continue
                # Same columns and request values as PUT /plan/{date}/{type}.
                # One transaction prevents partial weeks and concurrent overwrites.
                c.execute("""INSERT INTO meal_plan(meal_date,meal_type,recipe_id,eaters) VALUES(?,?,?,?)
                    ON CONFLICT(meal_date,meal_type) DO UPDATE SET
                    recipe_id=excluded.recipe_id,eaters=excluded.eaters
                    WHERE meal_plan.completed_at IS NULL""",
                    (meal["meal_date"], meal["meal_type"], meal["recipe_id"], meal["eaters"]))
            from core import audit_meals
            audit = audit_meals(incoming, {recipe["id"]: recipe for recipe in recipes}, stock)
            plans, _, _, _ = helpers()
            saved = plans(c, data.start, 7)
            nutrition_by_id = {recipe["id"]: recipe for recipe in recipes}
            nutrition_preview = [describe(meal, nutrition_by_id) for meal in incoming]
            result = {"ok": True, "saved_count": 21 - kept, "kept_completed": kept,
                      "meals": saved, "audit": audit,
                      "daily_nutrition": summarize_nutrition(nutrition_preview),
                      "expected_version": version(saved, size)}
    except sqlite3.Error:
        raise HTTPException(500, "The weekly plan could not be saved. All changes were rolled back; no meals were saved.")
    return result
