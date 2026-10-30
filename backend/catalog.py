"""Sample Indian recipes. Quantities are illustrative, not nutritional advice."""

RECIPES = [
    {
        "name": "Vegetable Poha", "category": "Breakfast", "tags": ["quick", "vegetarian", "breakfast"],
        "base_servings": 2, "calories_per_serving": 280, "minutes": 20,
        "ingredients": [["Poha", 140, "g"], ["Onion", 80, "g"], ["Potato", 100, "g"], ["Peanuts", 30, "g"], ["Oil", 20, "ml"]],
        "steps": ["Rinse poha briefly and drain without soaking it too long.", "Heat oil and lightly cook peanuts, then set them aside.", "Sauté chopped onion and potato until the potato is cooked through.", "Add poha and seasonings to taste, stir gently and heat thoroughly.", "Top with peanuts and serve hot."],
    },
    {
        "name": "Dal Rice", "category": "Lunch", "tags": ["comfort", "vegetarian", "simple"],
        "base_servings": 2, "calories_per_serving": 440, "minutes": 35,
        "ingredients": [["Rice", 160, "g"], ["Toor dal", 120, "g"], ["Tomato", 120, "g"], ["Onion", 80, "g"], ["Oil", 15, "ml"]],
        "steps": ["Rinse rice and dal separately.", "Cook rice in water until tender.", "Cook dal with water until soft, following your pressure cooker instructions if using one.", "Sauté chopped onion and tomato in oil and add spices to taste.", "Combine the tempering with dal, simmer and serve with rice."],
    },
    {
        "name": "Paneer Masala", "category": "Dinner", "tags": ["spicy", "vegetarian", "special"],
        "base_servings": 2, "calories_per_serving": 410, "minutes": 35,
        "ingredients": [["Paneer", 220, "g"], ["Tomato", 240, "g"], ["Onion", 160, "g"], ["Butter", 30, "g"], ["Milk", 100, "ml"]],
        "steps": ["Dice paneer and chop onion and tomato.", "Heat butter, sauté onion until soft, then add tomatoes.", "Add spices to taste and cook until the tomatoes form a thick sauce.", "Stir in milk gently, then add paneer and simmer until heated through.", "Check seasoning and serve immediately."],
    },
    {
        "name": "Vegetable Pulao", "category": "Lunch", "tags": ["quick", "vegetarian", "rice"],
        "base_servings": 2, "calories_per_serving": 390, "minutes": 30,
        "ingredients": [["Rice", 180, "g"], ["Onion", 100, "g"], ["Potato", 120, "g"], ["Peas", 80, "g"], ["Oil", 20, "ml"]],
        "steps": ["Rinse rice thoroughly.", "Sauté onion and diced vegetables in oil with spices.", "Add rice and measured water according to the rice type.", "Cover and cook until the rice and vegetables are tender.", "Rest briefly, fluff and serve."],
    },
    {
        "name": "Aloo Paratha", "category": "Breakfast", "tags": ["comfort", "vegetarian", "breakfast"],
        "base_servings": 2, "calories_per_serving": 360, "minutes": 40,
        "ingredients": [["Wheat flour", 200, "g"], ["Potato", 250, "g"], ["Oil", 20, "ml"], ["Onion", 50, "g"]],
        "steps": ["Boil potatoes until completely cooked and mash them.", "Mix chopped onion and spices into the mashed potato.", "Knead wheat flour with water into a soft dough.", "Stuff flattened dough with the potato mixture and roll carefully.", "Cook both sides on a hot tawa using a little oil until fully cooked."],
    },
    {
        "name": "Vegetable Upma", "category": "Breakfast", "tags": ["quick", "vegetarian", "breakfast"],
        "base_servings": 2, "calories_per_serving": 310, "minutes": 25,
        "ingredients": [["Semolina", 160, "g"], ["Onion", 80, "g"], ["Peas", 60, "g"], ["Oil", 20, "ml"]],
        "steps": ["Dry roast semolina until aromatic, then set aside.", "Sauté onion and peas in oil until tender.", "Add measured water carefully and bring it to a simmer.", "Slowly add semolina while stirring to prevent lumps.", "Cook until water is absorbed and the upma is soft."],
    },
    {
        "name": "Leftover Rice Fried Rice", "category": "Dinner", "tags": ["leftovers", "quick", "rice", "spicy"],
        "base_servings": 2, "calories_per_serving": 340, "minutes": 15,
        "ingredients": [["Cooked rice", 350, "g"], ["Onion", 80, "g"], ["Peas", 80, "g"], ["Oil", 20, "ml"]],
        "steps": ["Check that leftover rice was cooled promptly and refrigerated safely; discard if storage is uncertain.", "Heat oil, then sauté chopped onion and peas until cooked.", "Add cold refrigerated cooked rice and break up clumps.", "Stir-fry until steaming hot all the way through; season to taste.", "Serve immediately and do not reheat the rice again."],
    },
    {
        "name": "Leftover Roti Upma", "category": "Breakfast", "tags": ["leftovers", "quick", "breakfast"],
        "base_servings": 2, "calories_per_serving": 300, "minutes": 15,
        "ingredients": [["Leftover roti", 4, "pcs"], ["Onion", 80, "g"], ["Tomato", 120, "g"], ["Oil", 15, "ml"]],
        "steps": ["Only use rotis stored safely; discard if mouldy or storage is uncertain.", "Tear rotis into small pieces.", "Sauté onion and tomato with spices in oil until softened.", "Add roti pieces and a small splash of water if needed.", "Toss until thoroughly heated, and serve immediately."],
    },
]

STARTER_INVENTORY = [
    ("Rice", 1500, "g", None, 0, None, None),
    ("Toor dal", 600, "g", None, 0, None, None),
    ("Tomato", 450, "g", None, 0, None, None),
    ("Onion", 800, "g", None, 0, None, None),
    ("Potato", 700, "g", None, 0, None, None),
    ("Wheat flour", 1000, "g", None, 0, None, None),
    ("Poha", 400, "g", None, 0, None, None),
    ("Paneer", 200, "g", None, 0, None, None),
    ("Butter", 20, "g", None, 0, None, None),
    ("Milk", 500, "ml", None, 0, None, None),
    ("Oil", 400, "ml", None, 0, None, None),
    ("Peanuts", 150, "g", None, 0, None, None),
    ("Peas", 130, "g", None, 0, None, None),
    ("Semolina", 250, "g", None, 0, None, None),
]
