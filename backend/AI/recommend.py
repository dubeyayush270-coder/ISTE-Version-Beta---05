from AI.query_builder import build_search_queries
from AI.search import search_recipes
from AI.process_recipe import process_recipe


MAX_SEARCH_QUERIES = 3
MAX_PAGES_TO_CHECK = 5


def get_recipe_recommendations(configuration, max_results=3):
    """Find eligible recipes, with bounded retries and per-page failure isolation.

    The return structure remains compatible with the existing KitchenSync API.
    """
    queries = build_search_queries(configuration)
    preferences = configuration.get("preferences", {})

    valid_recipes = []
    seen_urls = set()
    pages_checked = 0

    for query in queries[:MAX_SEARCH_QUERIES]:
        if len(valid_recipes) >= max_results or pages_checked >= MAX_PAGES_TO_CHECK:
            break

        print("Searching for:", query, flush=True)
        results = search_recipes(query, max_results=2)

        if not results:
            # Keep the original food-type restriction when falling back.
            dish = query.split('"')[1] if '"' in query else query
            fallback_query = f"{dish} Indian recipe"
            food_type = preferences.get("food_type")
            if food_type:
                fallback_query += f" {food_type}"

            print("Retrying with:", fallback_query, flush=True)
            results = search_recipes(fallback_query, max_results=2)

        for result in results or []:
            if len(valid_recipes) >= max_results or pages_checked >= MAX_PAGES_TO_CHECK:
                break

            url = result.get("url")
            if not url or url in seen_urls:
                continue

            seen_urls.add(url)
            pages_checked += 1
            print("Checking recipe:", url, flush=True)

            try:
                processed = process_recipe(url, preferences)
            except Exception as error:
                print("Processing error:", error, flush=True)
                continue

            if not processed or processed.get("status") != "success":
                continue

            for item in processed.get("recipes", []):
                validation = item.get("validation", {})
                recipe = item.get("recipe", {})

                if validation.get("status") != "eligible":
                    continue

                valid_recipes.append({
                    "title": recipe.get("title", "Unknown"),
                    "url": url,
                    "ingredients": recipe.get("ingredients", []),
                    "instructions": recipe.get("instructions", []),
                    "cooking_time": recipe.get("cooking_time", "Unknown"),
                })

                if len(valid_recipes) >= max_results:
                    break

    print("Eligible recipes found:", len(valid_recipes), flush=True)

    # Preserve the return shape and meaning from the current main project.
    return {
        "search_query": "\n".join(queries),
        "search_queries": queries,
        "recipes": valid_recipes,
    }
