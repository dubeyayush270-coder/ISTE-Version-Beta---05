"""Nutrition, user locks and real-leftover weekly planning regression tests."""
from datetime import date, timedelta
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from weekly_planner import generate_week, nutrition_per_serving, summarize_nutrition


def recipe(identifier, category, protein=None, calories=0, tags=None):
    return {"id": identifier, "name": f"R{identifier}", "category": category,
            "base_servings": 2, "calories_per_serving": calories,
            "protein_g_per_serving": protein, "carbs_g_per_serving": None,
            "fat_g_per_serving": None, "nutrition_source": "user_entered" if protein else "unknown",
            "minutes": 20, "ingredients": [["Rice", 100, "g"]], "tags": tags or []}


def library():
    return [recipe(1, "breakfast", protein=5, calories=250),
            recipe(2, "breakfast", protein=32, calories=500),
            recipe(3, "lunch", protein=9, calories=340),
            recipe(4, "dinner", protein=11, calories=370)]


def pantry():
    return [{"name":"Rice","quantity":99999,"unit":"g","is_leftover":0,"expiry_date":None}]


class NutritionPlanningTests(unittest.TestCase):
    def test_unknown_macros_never_become_zero(self):
        value = nutrition_per_serving({"calories_per_serving":0})
        self.assertIsNone(value["calories"])
        self.assertIsNone(value["protein_g"])
        self.assertIsNone(value["carbs_g"])
        result = summarize_nutrition([
            {"meal_date":"2026-11-02", "nutrition": value},
            {"meal_date":"2026-11-02", "nutrition": {"calories":350,"protein_g":17,
             "carbs_g":30,"fat_g":13}},
        ])
        self.assertEqual(result[0]["known_meals"], 1)
        self.assertIsNone(result[0]["per_person_if_attending_all"]["calories"])

    def test_high_protein_preference_can_override_pantry_tie(self):
        meals = generate_week(date.today(), library(), pantry(), [], 2,
                              {"nutrition_goal":"high_protein"}, seed=3)["meals"]
        self.assertEqual(meals[0]["recipe_id"], 2)
        self.assertEqual(meals[0]["nutrition"]["protein_g"], 32)

    def test_leftovers_are_not_predicted_for_future(self):
        recipes = library()
        recipes.append(recipe(5,"dinner",protein=12,calories=390,tags=["leftovers"]))
        meals = generate_week(date.today(), recipes, pantry(), [], 2, {}, seed=1)["meals"]
        self.assertNotIn(5, [m["recipe_id"] for m in meals if m["meal_date"] != date.today().isoformat()])

    def test_lock_keeps_recipe_when_regenerating(self):
        start = date.today()
        initial = generate_week(start, library(), pantry(), [], 2, {}, seed=1)
        pinned = {(initial["meals"][0]["meal_date"], initial["meals"][0]["meal_type"]): initial["meals"][0]}
        next_week = generate_week(start, library(), pantry(), [], 2, {}, seed=9, pinned_meals=pinned)
        self.assertEqual(next_week["meals"][0]["recipe_id"], initial["meals"][0]["recipe_id"])
        self.assertEqual(len(next_week["meals"]), 21)

    def test_schema_and_user_nutrition_roundtrip(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"KITCHENSYNC_DB":str(Path(directory)/"test.sqlite3")}):
            import importlib, db
            previous = db.DB_PATH
            db.DB_PATH = Path(directory)/"test.sqlite3"
            try:
                db.init_db(); db.init_db()
                from db import connection
                with connection() as c:
                    columns = {x["name"] for x in c.execute("PRAGMA table_info(recipes)")}
                    self.assertIn("protein_g_per_serving",columns)
                    self.assertIn("nutrition_source",columns)
                    row = c.execute("SELECT * FROM recipes LIMIT 1").fetchone()
                    self.assertEqual(row["nutrition_source"], "illustrative")
                    # Directly exercise the nutrition route with the active DB.
                    from recipe_nutrition_api import NutritionUpdate, update_recipe_nutrition
                    update_recipe_nutrition(row["id"],NutritionUpdate(
                        calories_per_serving=420,protein_g_per_serving=27,
                        carbs_g_per_serving=55,fat_g_per_serving=12))
                    row2 = c.execute("SELECT * FROM recipes WHERE id=?",(row["id"],)).fetchone()
                    self.assertEqual(row2["protein_g_per_serving"],27)
                    self.assertEqual(row2["nutrition_source"],"user_entered")
            finally:
                db.DB_PATH = previous

if __name__ == '__main__':unittest.main()
