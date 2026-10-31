from AI.recommend import get_recipe_recommendations
from AI.config import create_user_configuration
from AI.filter_recipes import filter_recipes

configuration = create_user_configuration(
    "kids_tiffin",
    {
        "budget": 80,
        "food_type": "vegetarian",
        "exclude": ["carrot"],
        "cooking_time": 20
    }
)

search_results = get_recipe_recommendations(configuration)["recipes"]

recommendations = filter_recipes(configuration, search_results)

print("\nKitchenSync Recommendations")
print("---------------------------")

for recipe in recommendations["recommendations"]:
    print("\nRecipe:", recipe["title"])
    print("Link:", recipe["url"])
    print("Reason:", recipe["reason"])
    print("Cost:", recipe["estimated_cost"])
    print("Cooking Time:", recipe["cooking_time"])
    print("Restriction Status:", recipe["restriction_status"])
    print("Ingredients to Check:", recipe["ingredients_to_check"])