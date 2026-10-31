
from AI.extract_recipe import extract_recipe
from AI.validate_recipe import validate_recipe


def process_recipe(url, preferences):

    # Step 1: Extract recipe from website
    result = extract_recipe(url)

    # Step 2: Handle extraction errors
    if "error" in result:
        return {
            "status": "error",
            "message": result["error"]
        }

    # Step 3: Check whether recipe data exists
    if not result["recipes"]:
        return {
            "status": "needs_review",
            "message": "No recipe data found"
        }

    processed_recipes = []

    # Step 4: Validate each extracted recipe
    for recipe in result["recipes"]:

        validation = validate_recipe(
            recipe,
            preferences
        )

        processed_recipes.append({
            "recipe": recipe,
            "validation": validation
        })

    return {
        "status": "success",
        "recipes": processed_recipes
    }

