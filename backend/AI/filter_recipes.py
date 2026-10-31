import json
from AI.gemini import ask_gemini


def filter_recipes(configuration, search_results):

    prompt = f"""
You are KitchenSync's recipe recommendation assistant.

USER PREFERENCES:
{json.dumps(configuration, indent=2)}

SEARCH RESULTS:
{json.dumps(search_results, indent=2)}

TASK:
1. Rank recipes according to the selected user mode.
2. Respect dietary restrictions and excluded ingredients.
3. Never recommend a recipe if a search result explicitly confirms
   that it contains an excluded ingredient.
4. Do not assume a recipe is safe just because its ingredients
   are not mentioned in the search description.
5. Do not invent costs, cooking times or nutrition values.
6. Mark unavailable information as Unknown.
7. Flag ingredients that need verification.

Return ONLY valid JSON. Do not use Markdown code fences.

Use this exact structure:

{{
  "recommendations": [
    {{
      "title": "Recipe name",
      "url": "Original URL",
      "reason": "Reason for recommendation",
      "estimated_cost": "Unknown",
      "cooking_time": "Unknown",
      "ingredients_to_check": [],
      "restriction_status": "needs_review"
    }}
  ]
}}
"""

    response = ask_gemini(prompt)

    # Extract JSON if Gemini adds code fences
    response = response.strip()
    response = response.removeprefix("```json").removeprefix("```")
    response = response.removesuffix("```").strip()

    try:
        return json.loads(response)
    except json.JSONDecodeError as error:
        raise ValueError(
            "Gemini returned invalid JSON. Please try again."
        ) from error