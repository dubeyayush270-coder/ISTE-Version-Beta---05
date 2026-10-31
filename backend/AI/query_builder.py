
def build_search_queries(configuration):

    mode = configuration["name"]
    preferences = configuration.get("preferences", {})

    if mode == "Kids Healthy Tiffin":
        dishes = [
            "vegetable sandwich",
            "paneer roll",
            "vegetable poha",
            "besan chilla",
            "mini idli"
        ]

    elif mode == "Fitness Mode":
        dishes = [
            "high protein paneer recipe",
            "soya chunks recipe",
            "moong dal chilla",
            "sprouts salad"
        ]

    elif mode == "Budget Friendly":
        dishes = [
            "budget friendly Indian vegetable recipe",
            "besan chilla",
            "vegetable poha",
            "dal khichdi"
        ]

    else:
        dishes = [
            "vegetable pulao",
            "dal khichdi",
            "vegetable sandwich",
            "moong dal chilla"
        ]

    queries = []

    for dish in dishes:

        query = (
            f'"{dish}" Indian individual recipe '
            "ingredients instructions"
        )

        if preferences.get("food_type"):
            query += " " + preferences["food_type"]

        if preferences.get("exclude"):
            query += (
                " without " + ", ".join(preferences["exclude"])
            )

        if preferences.get("cooking_time"):
            query += f" under {preferences['cooking_time']} minutes"

        queries.append(query)

    return queries
