
import re


NON_VEGETARIAN_INGREDIENTS = [
    "egg",
    "chicken",
    "mutton",
    "lamb",
    "beef",
    "pork",
    "fish",
    "prawns",
    "shrimp",
    "crab",
    "lobster",
    "seafood",
    "bacon",
    "ham",
    "sausage",
    "gelatin",
    "fish sauce",
    "oyster sauce"
]

def has_instructions(instructions):
    """Check whether a recipe contains actual cooking instructions."""

    if isinstance(instructions, str):
        return bool(instructions.strip())

    if isinstance(instructions, list):
        return any(has_instructions(item) for item in instructions)

    if isinstance(instructions, dict):
        if instructions.get("text"):
            return True

        return any(
            has_instructions(value)
            for value in instructions.values()
        )

    return False


def get_minutes(duration):
    """Convert ISO cooking time such as PT15M or PT1H20M into minutes."""

    if not isinstance(duration, str):
        return None

    match = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?",
        duration.upper()
    )

    if not match:
        return None

    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)

    total = hours * 60 + minutes

    return total if total > 0 else None



# Common alternative names for selected ingredients.
INGREDIENT_ALIASES = {
    "peanut": ("peanut", "groundnut"),
    "groundnut": ("groundnut", "peanut"),
    "onion": ("onion", "pyaaz", "pyaz"),
    "egg": ("egg", "anda"),
}


def ingredient_mentioned(ingredient_text, ingredient_name):
    """
    Match whole ingredient names, simple plurals,
    and selected alternative names.

    This is best-effort filtering, not an allergy guarantee.
    """
    name = " ".join(str(ingredient_name).casefold().split())

    if not name:
        return False

    alternatives = INGREDIENT_ALIASES.get(name, (name,))

    for alternative in alternatives:
        pattern = (
            r"(?<!\w)"
            + re.escape(alternative)
            + r"(?:s|es)?(?!\w)"
        )

        if re.search(pattern, ingredient_text):
            return True

    return False


def find_non_vegetarian_ingredients(ingredients):
    ingredient_text = " ".join(
        str(item) for item in ingredients
    ).casefold()

    return [
        ingredient
        for ingredient in NON_VEGETARIAN_INGREDIENTS
        if ingredient_mentioned(ingredient_text, ingredient)
    ]



def validate_recipe(recipe, preferences):

    ingredients = recipe.get("ingredients", [])
    instructions = recipe.get("instructions", [])
    
    # Check whether ingredient data has a valid format
    if not isinstance(ingredients, list):
        return {
        "is_valid": False,
        "status": "needs_review",
        "reason": "Ingredient information has an invalid format",
        "matched_ingredients": []
    }
    
    # Check for empty or invalid ingredient entries
    if not ingredients or any(
        not isinstance(item, str) or not item.strip()
        for item in ingredients
    ):
        return {
        "is_valid": False,
        "status": "needs_review",
        "reason": "Ingredient list contains missing or invalid entries",
        "matched_ingredients": []
    }

    # 1. Check whether ingredients are available
    if not ingredients:
        return {
            "is_valid": False,
            "status": "needs_review",
            "reason": "Ingredient information is missing",
            "matched_ingredients": []
        }

    # 2. Check whether actual cooking instructions exist
    if not has_instructions(instructions):
        return {
            "is_valid": False,
            "status": "needs_review",
            "reason": "Cooking instructions are missing",
            "matched_ingredients": []
        }

    ingredient_text = " ".join(
        str(item) for item in ingredients
    ).lower()

    # 3. Check vegetarian preference
    if preferences.get("food_type") == "vegetarian":

        non_veg_items = find_non_vegetarian_ingredients(
            ingredients
        )

        if non_veg_items:
            return {
                "is_valid": False,
                "status": "rejected",
                "reason": "Recipe contains non-vegetarian ingredients",
                "matched_ingredients": non_veg_items
            }
    # 4. Check excluded ingredients
    excluded_ingredients = preferences.get("exclude", []) or []

    found_excluded = []

    for item in excluded_ingredients:
        if ingredient_mentioned(ingredient_text, item):
            found_excluded.append(item)


    if found_excluded:
        return {
            "is_valid": False,
            "status": "rejected",
            "reason": "Recipe contains excluded ingredients",
            "matched_ingredients": found_excluded
        }

    # 5. Check cooking time
    max_time = preferences.get("cooking_time")

    if max_time is not None:

        actual_time = get_minutes(
            recipe.get("cooking_time")
        )

        if actual_time is None:
            return {
                "is_valid": False,
                "status": "needs_review",
                "reason": "Cooking time is missing or unclear",
                "matched_ingredients": []
            }

        if actual_time > max_time:
            return {
                "is_valid": False,
                "status": "rejected",
                "reason": "Recipe exceeds the maximum cooking time",
                "matched_ingredients": []
            }

    # 6. All available checks passed
    return {
        "is_valid": True,
        "status": "eligible",
        "reason": "Recipe passed the available validation checks",
        "matched_ingredients": []
    }
