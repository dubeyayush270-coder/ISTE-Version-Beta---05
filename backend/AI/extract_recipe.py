
import requests
import json
import re
from bs4 import BeautifulSoup


def calculate_total_time(prep_time, cook_time):

    def convert_to_minutes(duration):

        if not isinstance(duration, str):
            return None

        match = re.fullmatch(
            r"PT(?:(\d+)H)?(?:(\d+)M)?",
            duration.upper()
        )

        if not match:
            return None

        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)

        return hours * 60 + minutes

    prep = convert_to_minutes(prep_time)
    cook = convert_to_minutes(cook_time)

    if prep is None or cook is None:
        return "Unknown"

    total = prep + cook

    if total == 0:
        return "Unknown"

    return f"PT{total}M"


def extract_recipe(url):

    try:
        response = requests.get(
            url,
            timeout=15,
            headers={"User-Agent": "Mozilla/5.0"}
        )

        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        recipe_data = []

        scripts = soup.find_all(
            "script",
            type="application/ld+json"
        )

        for script in scripts:

            try:
                data = json.loads(
                    script.string or script.get_text()
                )

                items = data if isinstance(data, list) else [data]

                for item in items:

                    if not isinstance(item, dict):
                        continue

                    if "@graph" in item:
                        items.extend(item["@graph"])

                    item_type = item.get("@type", [])

                    if isinstance(item_type, str):
                        item_type = [item_type]

                    if "Recipe" not in item_type:
                        continue

                    prep_time = item.get("prepTime", "Unknown")
                    cook_time = item.get("cookTime", "Unknown")

                    total_time = item.get("totalTime", "Unknown")

                    if total_time == "Unknown":
                        total_time = calculate_total_time(
                            prep_time,
                            cook_time
                        )

                    recipe_data.append({
                        "title": item.get("name", "Unknown"),
                        "ingredients": item.get(
                            "recipeIngredient", []
                        ),
                        "instructions": item.get(
                            "recipeInstructions", []
                        ),
                        "cooking_time": total_time,
                        "prep_time": prep_time,
                        "cook_time": cook_time,
                        "servings": item.get(
                            "recipeYield", "Unknown"
                        )
                    })

            except (json.JSONDecodeError, TypeError):
                continue

        return {
            "url": url,
            "recipes": recipe_data
        }

    except requests.RequestException as error:

        return {
            "url": url,
            "error": str(error)
        }
