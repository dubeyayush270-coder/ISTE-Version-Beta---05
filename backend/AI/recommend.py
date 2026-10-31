
from AI.query_builder import build_search_queries
from AI.search import search_recipes
from AI.process_recipe import process_recipe


def get_recipe_recommendations(configuration):

    queries = build_search_queries(configuration)

    all_search_results = []
    seen_urls = set()

    # Step 1: Search separately for each dish
    for query in queries:

        print("\nSearching for:", query)

        results = search_recipes(query, max_results=3)

        print("Results returned:", len(results))

        # Retry with a simpler query if no results are found
        if not results:

            dish = query.split('"')[1]

            fallback_query = f"{dish} Indian recipe"

            food_type = configuration.get(
                "preferences", {}
            ).get("food_type")

            if food_type:
                fallback_query += " " + food_type

            print("Retrying with:", fallback_query)

            results = search_recipes(
                fallback_query,
                max_results=3
            )

            print("Fallback results:", len(results))

        for result in results:

            url = result.get("url")

            if not url or url in seen_urls:
                continue

            seen_urls.add(url)
            all_search_results.append(result)

    print("\nSearch results found:", len(all_search_results))

    valid_recipes = []

    # Step 2: Extract and validate each unique result
    for result in all_search_results:

        url = result.get("url")

        processed = process_recipe(
            url,
            configuration.get("preferences", {})
        )

        print("\nURL:", url)
        print("Processing status:", processed["status"])

        if processed["status"] != "success":
            print("Reason:", processed.get("message", "Unknown"))
            continue

        for item in processed["recipes"]:

            validation = item["validation"]
            recipe = item["recipe"]

            print("Recipe:", recipe["title"])
            print("Validation:", validation["status"])
            print("Reason:", validation["reason"])

            if validation["status"] == "eligible":

                valid_recipes.append({
                    "title": recipe["title"],
                    "url": url,
                    "ingredients": recipe["ingredients"],
                    "instructions": recipe["instructions"],
                    "cooking_time": recipe["cooking_time"]
                })

    return {
        "search_query": "\n".join(queries),
        "search_queries": queries,
        "recipes": valid_recipes
    }
