
from AI.validate_recipe import validate_recipe

preferences = {
    "exclude": ["carrot"],
    "cooking_time": 20
}

recipes = [
    {
        "title": "Veg Sandwich",
        "ingredients": ["bread", "carrot", "tomato"],
        "instructions": [
            {"text": "Chop the vegetables."},
            {"text": "Place vegetables between bread slices."}
        ],
        "cooking_time": "PT15M"
    },
    {
        "title": "Cheese Sandwich",
        "ingredients": ["bread", "cheese", "tomato"],
        "instructions": [
            {"text": "Place cheese and tomato between bread slices."},
            {"text": "Toast until golden."}
        ],
        "cooking_time": "PT15M"
    },
    {
        "title": "Collection Page",
        "ingredients": ["rice", "vegetables", "fruits", "roti"],
        "instructions": [],
        "cooking_time": "PT30M"
    },
    {
        "title": "Slow Recipe",
        "ingredients": ["bread", "cheese", "tomato"],
        "instructions": ["Prepare the sandwich."],
        "cooking_time": "PT30M"
    },
    {
        "title": "Unknown Recipe",
        "ingredients": [],
        "instructions": [],
        "cooking_time": "Unknown"
    }
]

for recipe in recipes:
    result = validate_recipe(recipe, preferences)

    print("\nRecipe:", recipe["title"])
    print("Status:", result["status"])
    print("Reason:", result["reason"])
    
    print("\nTesting vegetarian validation")

test_recipe = {
    "ingredients": [
        "200g chicken",
        "1 onion",
        "1 tsp salt"
    ],
    "instructions": ["Cook all ingredients."],
    "cooking_time": "PT15M"
}

result = validate_recipe(
    test_recipe,
    {"food_type": "vegetarian"}
)

print(result)

print("\nTesting invalid ingredient format")

test_recipe = {
    "ingredients": "Paneer, onion, salt",
    "instructions": ["Mix and cook the ingredients."],
    "cooking_time": "PT15M"
}

result = validate_recipe(
    test_recipe,
    {"food_type": "vegetarian"}
)

print(result)


