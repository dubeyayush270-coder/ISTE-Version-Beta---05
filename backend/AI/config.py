
# KitchenSync AI - User Mode Configuration

USER_MODES = {

    "kids_tiffin": {
        "name": "Kids Healthy Tiffin",
        "focus": [
            "Tasty food",
            "Fruits and vegetables",
            "Creative presentation",
            "School-friendly meals",
            "Food variety"
        ],
        "priority": "Make healthy food appealing to children"
    },

    "fitness": {
        "name": "Fitness Mode",
        "focus": [
            "Protein",
            "Calories",
            "Balanced nutrition"
        ],
        "priority": "Meet the user's nutrition goals"
    },

    "budget": {
        "name": "Budget Friendly",
        "focus": [
            "Affordable ingredients",
            "Low-cost recipes",
            "Available kitchen stock"
        ],
        "priority": "Stay within the user's budget"
    },

    "everyday": {
        "name": "Everyday Healthy",
        "focus": [
            "Balanced meals",
            "Fruits and vegetables",
            "Food variety"
        ],
        "priority": "Encourage balanced eating"
    }
}


def get_user_mode(mode):

    if mode not in USER_MODES:
        raise ValueError("Invalid user mode selected")

    return USER_MODES[mode]


def create_user_configuration(mode, preferences=None):

    configuration = get_user_mode(mode).copy()

    configuration["preferences"] = preferences or {}

    return configuration
