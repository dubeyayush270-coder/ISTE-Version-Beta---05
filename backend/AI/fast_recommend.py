"""Fast, defensive recipe discovery for KitchenSync.

This replaces the slow DDGS -> website-scraping chain on the /api/ai/recommend
route. TheMealDB is queried at most once with a bounded timeout. Existing
KitchenSync library recipes are used as a truthful, offline fallback. Unknown
cooking time is explicitly marked for review, never claimed to satisfy a limit.
"""

from __future__ import annotations

import json
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from AI.validate_recipe import validate_recipe

# Keep the total network wait small enough for a mobile hackathon demo.
ONLINE_TIMEOUT_SECONDS = 2.5
ONLINE_URL = "https://www.themealdb.com/api/json/v1/1/search.php"
CACHE_TTL_SECONDS = 300
_CACHE: dict[str, tuple[float, list[dict]]] = {}
_LOCK = threading.Lock()

ONLINE_QUERIES = {
    "Kids Healthy Tiffin": "Sandwich",
    "Fitness Mode": "Chickpea",
    "Budget Friendly": "Rice",
    "Everyday Healthy": "Vegetable",
}

PREFERRED_TERMS = {
    "Kids Healthy Tiffin": ("sandwich", "roll", "poha", "idli", "chilla", "upma"),
    "Fitness Mode": ("paneer", "soya", "sprout", "chickpea", "dal", "protein"),
    "Budget Friendly": ("dal", "poha", "upma", "khichdi", "rice", "potato"),
}


def _online_meals(query: str) -> list[dict]:
    """One fixed-host request, with bounded body size and 5-min cache."""
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE.get(query)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]

    request = Request(
        f"{ONLINE_URL}?{urlencode({'s': query})}",
        headers={"User-Agent": "KitchenSync/1.0 (Recipe Discovery)"},
    )
    try:
        with urlopen(request, timeout=ONLINE_TIMEOUT_SECONDS) as response:
            payload = response.read(1024 * 1024 + 1)
        if len(payload) > 1024 * 1024:
            return []
        data = json.loads(payload)
        meals = data.get("meals") if isinstance(data, dict) else []
        if not isinstance(meals, list):
            meals = []
        meals = [m for m in meals[:15] if isinstance(m, dict)]
        with _LOCK:
            if len(_CACHE) > 30:
                _CACHE.clear()
            _CACHE[query] = (time.monotonic(), meals)
        return meals
    except (HTTPError, URLError, OSError, TimeoutError, ValueError, json.JSONDecodeError):
        # Offline/blocked provider: fall back to stored recipes rather than 502.
        return []


def _online_recipe(meal: dict) -> dict | None:
    ingredients = [
        (meal.get(f"strIngredient{i}") or "").strip()
        for i in range(1, 21)
    ]
    ingredients = [item for item in ingredients if item]
    raw = (meal.get("strInstructions") or "").strip()
    if not ingredients or not raw:
        return None
    instructions = [x.strip() for x in re.split(r"\n+", raw) if x.strip()]
    source_url = (meal.get("strSource") or "").strip()
    if not source_url.startswith(("https://", "http://")):
        meal_id = str(meal.get("idMeal") or "")
        source_url = f"https://www.themealdb.com/meal/{meal_id}" if meal_id.isdigit() else ""
    return {
        "title": str(meal.get("strMeal") or "Unknown recipe")[:140],
        "url": source_url,
        "ingredients": ingredients,
        "instructions": instructions[:30],
        "cooking_time": "Unknown",
        "origin": "TheMealDB",
        "time_unverified": True,
    }


def _saved_recipes() -> list[dict]:
    """Read the existing recipe library; never modify the database."""
    try:
        from db import connection
        with connection() as c:
            rows = c.execute(
                "SELECT name, minutes, ingredients, steps, tags FROM recipes "
                "ORDER BY name LIMIT 150"
            ).fetchall()
    except Exception:
        rows = []

    recipes = []
    for row in rows:
        try:
            ingredients = json.loads(row["ingredients"])
            steps = json.loads(row["steps"])
            items = [
                f"{str(entry[0])} — {entry[1]} {entry[2]}"
                for entry in ingredients
                if isinstance(entry, list) and len(entry) >= 3
            ]
            steps = [s for s in steps if isinstance(s, str) and s.strip()]
            minutes = int(row["minutes"])
            if not items or not steps or minutes <= 0:
                continue
            recipes.append({
                "title": str(row["name"]),
                "url": "",
                "ingredients": items,
                "instructions": steps,
                "cooking_time": f"PT{minutes}M",
                "origin": "KitchenSync library",
                "time_unverified": False,
            })
        except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError):
            continue

    # Some deployments may not have initialized a library yet. Use the
    # explicitly labelled bundled sample recipes, not fabricated recipes.
    if not recipes:
        from catalog import RECIPES
        for row in RECIPES:
            recipes.append({
                "title": row["name"],
                "url": "",
                "ingredients": [f"{n} — {q} {u}" for n, q, u in row["ingredients"]],
                "instructions": row["steps"],
                "cooking_time": f"PT{row['minutes']}M",
                "origin": "KitchenSync sample library",
                "time_unverified": False,
            })
    return recipes


def _rank(recipe: dict, mode: str) -> int:
    title = recipe["title"].casefold()
    return sum(3 if key in title else 0 for key in PREFERRED_TERMS.get(mode, ()))


def get_fast_recipe_recommendations(configuration: dict) -> dict:
    """Return verified ingredient matches quickly, with clear provenance."""
    preferences = configuration.get("preferences", {})
    mode = configuration.get("name", "Everyday Healthy")
    max_results = max(1, min(10, int(configuration.get("max_results", 10))))
    query = ONLINE_QUERIES.get(mode, "Vegetable")

    online = [_online_recipe(meal) for meal in _online_meals(query)]
    candidates = [recipe for recipe in online if recipe is not None]
    candidates += _saved_recipes()
    eligible, review = [], []
    for candidate in candidates:
        name = candidate["title"].strip().casefold()
        if not name:
            continue
        validation = validate_recipe(candidate, preferences)
        status = validation["status"]
        if status == "eligible":
            candidate["review_note"] = ""
            eligible.append(candidate)
        elif status == "needs_review" and candidate.get("time_unverified"):
            # Include a source-backed recipe with unknown time as a *review*
            # result, not a confirmed match to the cooking-time limit.
            candidate["review_note"] = "Cooking time unverified — check source before cooking"
            review.append(candidate)

    eligible.sort(key=lambda r: (-_rank(r, mode), r["origin"] != "TheMealDB"))
    review.sort(key=lambda r: -_rank(r, mode))
    recipes = []
    seen = set()
    for recipe in eligible + review:
        key = recipe["title"].strip().casefold()
        if key in seen:
            continue
        seen.add(key)
        recipes.append(recipe)
        if len(recipes) >= max_results:
            break
    return {
        "recipes": recipes,
        "search_queries": [f"TheMealDB: {query}", "KitchenSync library"],
        "source": "TheMealDB + KitchenSync library" if online else "KitchenSync library",
    }
