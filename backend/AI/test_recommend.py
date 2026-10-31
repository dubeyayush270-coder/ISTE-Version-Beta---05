
from AI.config import create_user_configuration
from AI.recommend import get_recipe_recommendations

configuration = create_user_configuration(
    "kids_tiffin",
    {
        "budget": 80,
        "food_type": "vegetarian",
        "exclude": ["carrot"],
        "cooking_time": 20
    }
)

result = get_recipe_recommendations(configuration)

print("\nKitchenSync AI Recommendations")
print("--------------------------------")
print("Generated Query:", result["search_query"])

if not result["recipes"]:
    print("\nNo eligible individual recipes found.")

else:
    for index, recipe in enumerate(result["recipes"], start=1):
        print(f"\nRecipe {index}: {recipe['title']}")
        print("Link:", recipe["url"])
        print("Ingredients:", recipe["ingredients"])
        print("Cooking Time:", recipe["cooking_time"])
