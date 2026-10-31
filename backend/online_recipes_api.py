"""Reviewed imports of online recipes into KitchenSync's existing recipe library.

Online suggestions NEVER change Pantry, create leftovers, or write meal plans.
Recipes are imported only after a user confirms measurable ingredient amounts.
TheMealDB's shared test key is intended for development/educational use.
"""

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, StrictBool
from typing import Literal

def connection():
    # Resolve the active database on every request (supports isolated tests).
    from db import connection as current_connection
    return current_connection()

router = APIRouter(prefix="/api/recipes/online", tags=["Online recipe discovery"])
BASE = "https://www.themealdb.com/api/json/v1/1"


def _provider_json(endpoint: str, **params):
    """Fetch only fixed provider paths, never arbitrary user URLs."""
    if endpoint not in ("search.php", "lookup.php"):
        raise HTTPException(500, "Unsupported recipe lookup")
    url = f"{BASE}/{endpoint}?{urlencode(params)}"
    try:
        request = Request(url, headers={"User-Agent": "KitchenSyncHackathon/0.3"})
        with urlopen(request, timeout=8) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise HTTPException(502, "Online recipe response is too large")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Invalid provider response")
        return data
    except HTTPException:
        raise
    except (HTTPError, URLError, TimeoutError, ValueError, OSError, json.JSONDecodeError) as exc:
        raise HTTPException(502, "Online recipes are unavailable. Try saved recipes instead.") from exc


def _summary(meal):
    return {
        "meal_id": str(meal.get("idMeal") or ""),
        "name": meal.get("strMeal") or "Unknown dish",
        "area": meal.get("strArea") or "",
        "category": meal.get("strCategory") or "",
        "image": meal.get("strMealThumb") or "",
        "provider": "TheMealDB",
    }


def _get_details(meal_id: str):
    if not re.fullmatch(r"\d{1,12}", meal_id):
        raise HTTPException(422, "Invalid online recipe ID")
    result = _provider_json("lookup.php", i=meal_id)
    records = result.get("meals") or []
    if not records or str(records[0].get("idMeal")) != meal_id:
        raise HTTPException(404, "Online recipe not found")
    return records[0]


def _strict_measure(value, ingredient_name=""):
    """Convert stated units to KitchenSync units without inventing densities.

    Spoon measures are volumes (ml), *not* estimated masses (g).
    Countable bare numerals can be interpreted as pieces only for known items.
    """
    raw = str(value or "").strip().lower().replace("½", "1/2").replace("¼", "1/4").replace("¾", "3/4")
    raw = re.sub(r"\s+", " ", raw)
    match = re.fullmatch(r"(?P<number>(?:\d+\s+)?\d+/\d+|\d+(?:\.\d+)?)\s*(?P<unit>[a-z.]+)?", raw)
    if not match:
        return None, "g"
    number = match.group("number")
    if "/" in number:
        bits = number.split()
        frac = bits[-1].split("/")
        denominator = int(frac[1])
        if denominator == 0:
            return None, "g"
        amount = int(frac[0]) / denominator + (int(bits[0]) if len(bits) == 2 else 0)
    else:
        amount = float(number)
    unit = (match.group("unit") or "").rstrip(".")
    if amount <= 0:
        return None, "g"
    if unit in {"kg", "kilogram", "kilograms"}:
        return round(amount * 1000, 2), "g"
    if unit in {"g", "gram", "grams"}:
        return round(amount, 2), "g"
    if unit in {"l", "liter", "litre", "liters", "litres"}:
        return round(amount * 1000, 2), "ml"
    if unit in {"ml", "milliliter", "millilitre", "milliliters", "millilitres"}:
        return round(amount, 2), "ml"
    if unit in {"pcs", "pc", "piece", "pieces"}:
        return round(amount, 2), "pcs"
    if unit in {"tsp", "teaspoon", "teaspoons"}:
        return round(amount * 5, 2), "ml"
    if unit in {"tbsp", "tablespoon", "tablespoons"}:
        return round(amount * 15, 2), "ml"
    # A numeric count is not automatically a gram amount.
    countable = ("cashew", "nut", "egg", "clove", "chilli", "chili", "raisins", "raisins", "almond", "pistachio", "lime", "lemon")
    if not unit and any(x in ingredient_name.casefold() for x in countable) and float(amount).is_integer():
        return amount, "pcs"
    return None, "g"


def _details(meal):
    entries = []
    for index in range(1, 21):
        name = (meal.get(f"strIngredient{index}") or "").strip()
        if not name:
            continue
        measure = (meal.get(f"strMeasure{index}") or "").strip()
        quantity, unit = _strict_measure(measure, name)
        entries.append({
            "name": name[:80], "original_measure": measure,
            "quantity": quantity, "unit": unit,
        })
    raw_steps = (meal.get("strInstructions") or "").replace("\r", "\n")
    steps = [part.strip() for part in re.split(r"\n+", raw_steps) if part.strip()]
    if not steps and raw_steps.strip():
        steps = [raw_steps.strip()]
    if len(steps) == 1 and len(steps[0]) > 600:
        steps = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", steps[0]) if s.strip()]
    steps = [s[:600] for s in steps[:40]]
    source_url = meal.get("strSource") or ""
    if not (source_url.startswith("https://") or source_url.startswith("http://")):
        source_url = f"https://www.themealdb.com/meal/{meal.get('idMeal', '')}"
    return {**_summary(meal), "ingredients": entries, "steps": steps,
            "source_url": source_url, "nutrition_verified": False}


@router.get("/search")
def search_online_recipes(q: str = Query(min_length=2, max_length=60)):
    data = _provider_json("search.php", s=q.strip())
    return {"recipes": [_summary(x) for x in (data.get("meals") or [])[:16]],
            "source": "TheMealDB", "requires_review": True}


@router.get("/{meal_id}")
def online_recipe_details(meal_id: str):
    return _details(_get_details(meal_id))


class IngredientAmount(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: float = Field(gt=0, le=1000000)
    unit: Literal["g", "ml", "pcs"]


class ImportRequest(BaseModel):
    meal_id: str = Field(pattern=r"^\d{1,12}$")
    category: Literal["breakfast", "lunch", "dinner"]
    base_servings: int = Field(ge=1, le=30)
    minutes: int = Field(ge=1, le=240)
    ingredients: list[IngredientAmount] = Field(min_length=1, max_length=20)
    confirmed: StrictBool = False
    # Optional per-serving data supplied/reviewed by user; never scraped guesses.
    calories_per_serving: float | None = Field(default=None, ge=0, le=2500)
    protein_g_per_serving: float | None = Field(default=None, ge=0, le=300)
    carbs_g_per_serving: float | None = Field(default=None, ge=0, le=500)
    fat_g_per_serving: float | None = Field(default=None, ge=0, le=200)


@router.post("/import", status_code=201)
def import_online_recipe(data: ImportRequest):
    if not data.confirmed:
        raise HTTPException(422, "Review all ingredient quantities and confirm the recipe before importing")
    source = _details(_get_details(data.meal_id))
    source_ingredients = source["ingredients"]
    if not source_ingredients or not source["steps"]:
        raise HTTPException(422, "This recipe lacks usable ingredients or cooking instructions")
    if len(data.ingredients) != len(source_ingredients):
        raise HTTPException(422, "Every source ingredient needs a reviewed quantity")
    for entered, original in zip(data.ingredients, source_ingredients):
        if entered.name.strip().casefold() != original["name"].casefold():
            raise HTTPException(422, "Ingredient names must match the reviewed online recipe")
        if entered.unit == "pcs" and not float(entered.quantity).is_integer():
            raise HTTPException(422, "Piece quantities must be whole numbers")
    identifier = f"TheMealDB #{data.meal_id}"
    stored_name = f"{source['name'][:110]} ({identifier})"
    tags = ["online", "themealdb", source["area"].lower()[:40]]
    rows = [[item.name.strip(), round(item.quantity, 2), item.unit]
            for item in data.ingredients]
    if any(quantity <= 0 for _, quantity, _ in rows):
        raise HTTPException(422, "Ingredient quantities must be at least 0.01 in their chosen unit")
    with connection() as c:
        c.execute("BEGIN IMMEDIATE")
        existing = c.execute("SELECT id, category FROM recipes WHERE name=?", (stored_name,)).fetchone()
        if existing:
            if existing["category"].casefold() != data.category:
                raise HTTPException(409, "Already imported for a different meal type")
            return {"ok": True, "recipe_id": existing["id"], "name": stored_name,
                    "category": data.category, "already_imported": True}
        cursor = c.execute("""
            INSERT INTO recipes (name, category, tags, base_servings,
                                 calories_per_serving, minutes, ingredients, steps,
                                 protein_g_per_serving, carbs_g_per_serving,
                                 fat_g_per_serving, nutrition_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (stored_name, data.category, json.dumps(tags), data.base_servings,
              data.calories_per_serving or 0, data.minutes,
              json.dumps(rows), json.dumps(source["steps"]),
              data.protein_g_per_serving, data.carbs_g_per_serving,
              data.fat_g_per_serving,
              "user_entered" if any(x is not None for x in (
                  data.calories_per_serving, data.protein_g_per_serving,
                  data.carbs_g_per_serving, data.fat_g_per_serving)) else "unknown"))
        return {"ok": True, "recipe_id": cursor.lastrowid, "name": stored_name,
                "category": data.category, "already_imported": False}
