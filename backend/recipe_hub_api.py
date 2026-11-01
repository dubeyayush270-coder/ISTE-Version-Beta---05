"""Recipe Hub: personal favorites, notes, collections, price book and recipe copies.

No automatic Pantry mutations or nutrition estimates. Shared household until authentication exists.
"""
import json
import re
import sqlite3
from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Literal

router = APIRouter(prefix="/api/recipe-hub", tags=["Recipe Hub"])


def db():
    from db import connection
    return connection()


def initialize(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS recipe_hub_profiles (
        recipe_id INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
        rating INTEGER CHECK(rating BETWEEN 1 AND 5),
        notes TEXT NOT NULL DEFAULT '',
        collections TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS recipe_hub_prices (
        ingredient_key TEXT NOT NULL,
        unit TEXT NOT NULL CHECK(unit IN ('g','ml','pcs')),
        price_per_unit REAL NOT NULL CHECK(price_per_unit > 0),
        PRIMARY KEY(ingredient_key,unit)
    );
    CREATE TABLE IF NOT EXISTS recipe_hub_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        cooked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)


def check_recipe(c, recipe_id):
    recipe = c.execute("SELECT * FROM recipes WHERE id=?", (recipe_id,)).fetchone()
    if recipe is None:
        raise HTTPException(404, "Recipe not found")
    return recipe


class ProfileUpdate(BaseModel):
    favorite: bool = False
    rating: int | None = Field(default=None, ge=1, le=5)
    notes: str = Field(default="", max_length=2000)
    collections: list[str] = Field(default_factory=list, max_length=10)

    @field_validator('collections')
    @classmethod
    def validate_collections(cls, value):
        cleaned = []
        for name in value:
            name = name.strip()
            if not (1 <= len(name) <= 40):
                raise ValueError('Collection names must have 1–40 characters')
            if name.casefold() not in [item.casefold() for item in cleaned]:
                cleaned.append(name)
        return cleaned


@router.get('/overview')
def overview():
    with db() as c:
        initialize(c)
        profiles = {}
        for r in c.execute('SELECT * FROM recipe_hub_profiles'):
            profile = dict(r)
            profile['favorite'] = bool(profile['favorite'])
            profile['collections'] = json.loads(profile['collections'])
            profiles[str(r['recipe_id'])] = profile
        prices = [dict(r) for r in c.execute('SELECT * FROM recipe_hub_prices ORDER BY ingredient_key')]
        history = [dict(r) for r in c.execute('''
            SELECT h.recipe_id,r.name,COUNT(*) AS times_cooked,MAX(h.cooked_at) AS latest
            FROM recipe_hub_history h JOIN recipes r ON r.id=h.recipe_id
            GROUP BY h.recipe_id ORDER BY latest DESC LIMIT 80
        ''')]
        # Completed planned meals are already persisted by KitchenSync's existing Mark Cooked action.
        planned_history = [dict(r) for r in c.execute('''
            SELECT m.recipe_id,r.name,COUNT(*) AS times_cooked,MAX(m.completed_at) AS latest
            FROM meal_plan m JOIN recipes r ON r.id=m.recipe_id
            WHERE m.completed_at IS NOT NULL
            GROUP BY m.recipe_id
        ''')]
        history_by_id = {h['recipe_id']: h for h in history}
        for record in planned_history:
            previous = history_by_id.get(record['recipe_id'])
            if previous:
                previous['times_cooked'] += record['times_cooked']
                previous['latest'] = max(str(previous['latest'] or ''), str(record['latest'] or ''))
            else:
                history_by_id[record['recipe_id']] = record
        history = sorted(history_by_id.values(), key=lambda h: h['latest'] or '', reverse=True)
        return {'profiles': profiles, 'prices': prices, 'history': history[:80]}


@router.put('/recipes/{recipe_id}/profile')
def update_profile(recipe_id: int, data: ProfileUpdate):
    with db() as c:
        initialize(c)
        check_recipe(c, recipe_id)
        c.execute('''
            INSERT INTO recipe_hub_profiles(recipe_id,favorite,rating,notes,collections,updated_at)
            VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(recipe_id) DO UPDATE SET favorite=excluded.favorite,
            rating=excluded.rating,notes=excluded.notes,collections=excluded.collections,
            updated_at=CURRENT_TIMESTAMP
        ''', (recipe_id, int(data.favorite), data.rating, data.notes, json.dumps(data.collections)))
    return {'ok': True}


class Ingredient(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: float = Field(gt=0, le=1000000)
    unit: Literal['g', 'ml', 'pcs']

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Ingredient name cannot be blank')
        return value


class RecipeCopy(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    category: Literal['breakfast', 'lunch', 'dinner']
    base_servings: int = Field(ge=1, le=30)
    minutes: int = Field(ge=1, le=240)
    ingredients: list[Ingredient] = Field(min_length=1, max_length=40)
    steps: list[str] = Field(min_length=1, max_length=40)
    tags: list[str] = Field(default_factory=list, max_length=16)
    calories_per_serving: float | None = Field(default=None, ge=0, le=2500)
    protein_g_per_serving: float | None = Field(default=None, ge=0, le=300)
    carbs_g_per_serving: float | None = Field(default=None, ge=0, le=500)
    fat_g_per_serving: float | None = Field(default=None, ge=0, le=200)

    @field_validator('name')
    @classmethod
    def nonblank_name(cls, value):
        if not value.strip(): raise ValueError('Recipe name cannot be blank')
        return value.strip()

    @field_validator('steps')
    @classmethod
    def validate_steps(cls, value):
        if any(not s.strip() or len(s) > 600 for s in value):
            raise ValueError('Each step must contain 1–600 characters')
        return [s.strip() for s in value]

    @field_validator('tags')
    @classmethod
    def validate_tags(cls, value):
        if any(len(s) > 40 for s in value):
            raise ValueError('Tag too long')
        return [s.strip().lower() for s in value if s.strip()]


@router.post('/recipes/{recipe_id}/copy', status_code=201)
def copy_recipe(recipe_id: int, data: RecipeCopy):
    with db() as c:
        initialize(c)
        check_recipe(c, recipe_id)
        if any(i.unit == 'pcs' and not i.quantity.is_integer() for i in data.ingredients):
            raise HTTPException(422, 'Use whole numbers for piece counts')
        if c.execute('SELECT 1 FROM recipes WHERE name=? COLLATE NOCASE', (data.name,)).fetchone():
            raise HTTPException(409, 'A recipe already exists with that name')
        try:
            cursor = c.execute('''
                INSERT INTO recipes(name,category,tags,base_servings,calories_per_serving,minutes,
                                    ingredients,steps,protein_g_per_serving,carbs_g_per_serving,
                                    fat_g_per_serving,nutrition_source)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (data.name, data.category, json.dumps(['custom', *data.tags]), data.base_servings,
                  data.calories_per_serving if data.calories_per_serving is not None else 0,
                  data.minutes, json.dumps([[i.name,i.quantity,i.unit] for i in data.ingredients]),
                  json.dumps(data.steps), data.protein_g_per_serving, data.carbs_g_per_serving,
                  data.fat_g_per_serving, 'user_entered' if any(v is not None for v in (
                      data.calories_per_serving,data.protein_g_per_serving,data.carbs_g_per_serving,
                      data.fat_g_per_serving)) else 'unknown'))
            # A personal version starts as a favorite.
            c.execute('INSERT INTO recipe_hub_profiles(recipe_id,favorite) VALUES(?,1)', (cursor.lastrowid,))
            return {'ok': True, 'recipe_id': cursor.lastrowid, 'name': data.name}
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, 'Recipe name already exists') from exc


class PriceUpdate(BaseModel):
    ingredient: str = Field(min_length=1, max_length=80)
    unit: Literal['g', 'ml', 'pcs']
    price_per_unit: float = Field(gt=0, le=100000)


@router.put('/prices')
def save_price(data: PriceUpdate):
    key = data.ingredient.strip().casefold()
    if not key: raise HTTPException(422, 'Ingredient name cannot be blank')
    with db() as c:
        initialize(c)
        c.execute('''INSERT INTO recipe_hub_prices(ingredient_key,unit,price_per_unit)
                     VALUES(?,?,?) ON CONFLICT(ingredient_key,unit) DO UPDATE
                     SET price_per_unit=excluded.price_per_unit''', (key, data.unit, data.price_per_unit))
    return {'ok': True}


@router.post('/recipes/{recipe_id}/cooked', status_code=201)
def log_cooked(recipe_id: int):
    """Record history only. This does not deduct inventory or mark a planned meal complete."""
    with db() as c:
        initialize(c)
        check_recipe(c, recipe_id)
        c.execute('INSERT INTO recipe_hub_history(recipe_id) VALUES(?)', (recipe_id,))
    return {'ok': True, 'inventory_unchanged': True}
