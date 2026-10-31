
from AI.config import create_user_configuration

user_config = create_user_configuration(
    "kids_tiffin",
    {
        "budget": 80,
        "food_type": "vegetarian",
        "exclude": ["carrot"],
        "cooking_time": 20
    }
)

print("\nKitchenSync User Configuration")
print("--------------------------------")

print("Mode:", user_config["name"])
print("Focus:", user_config["focus"])
print("Priority:", user_config["priority"])
print("Custom Preferences:", user_config["preferences"])
