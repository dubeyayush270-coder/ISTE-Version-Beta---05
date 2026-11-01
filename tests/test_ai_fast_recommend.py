"""Regression tests for the fast, offline-tolerant recipe finder."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from AI.fast_recommend import get_fast_recipe_recommendations, _online_recipe


class FastRecipeSearchTests(unittest.TestCase):
    def setUp(self):
        self.cfg = {"name": "Everyday Healthy", "preferences": {
            "food_type": "vegetarian", "exclude": [], "cooking_time": 60
        }}
        self.saved = [
            {"title": "Dal Rice", "url": "", "origin": "KitchenSync library",
             "ingredients": ["Rice — 150 g", "Dal — 100 g"],
             "instructions": ["Cook rice", "Cook dal"],
             "cooking_time": "PT35M", "time_unverified": False},
            {"title": "Egg Curry", "url": "", "origin": "KitchenSync library",
             "ingredients": ["Egg — 2 pcs"],
             "instructions": ["Cook egg"],
             "cooking_time": "PT25M", "time_unverified": False},
        ]

    @patch("AI.fast_recommend._saved_recipes")
    @patch("AI.fast_recommend._online_meals")
    def test_offline_fallback_returns_saved_recipe(self, online, saved):
        online.return_value = []
        saved.return_value = self.saved
        result = get_fast_recipe_recommendations(self.cfg)
        self.assertEqual([x["title"] for x in result["recipes"]], ["Dal Rice"])
        self.assertEqual(result["recipes"][0]["origin"], "KitchenSync library")

    @patch("AI.fast_recommend._saved_recipes")
    @patch("AI.fast_recommend._online_meals")
    def test_excluded_ingredients_never_returned(self, online, saved):
        online.return_value = []
        saved.return_value = self.saved
        self.cfg["preferences"]["exclude"] = ["dal"]
        self.assertEqual(get_fast_recipe_recommendations(self.cfg)["recipes"], [])

    @patch("AI.fast_recommend._saved_recipes")
    @patch("AI.fast_recommend._online_meals")
    def test_unknown_time_requires_review(self, online, saved):
        saved.return_value = []
        online.return_value = [{
            "strMeal": "Vegetable Soup", "strIngredient1": "Potato",
            "strInstructions": "Boil vegetables", "idMeal": "1234"
        }]
        result = get_fast_recipe_recommendations(self.cfg)
        self.assertEqual(result["recipes"][0]["origin"], "TheMealDB")
        self.assertTrue(result["recipes"][0]["time_unverified"])
        self.assertIn("unverified", result["recipes"][0]["review_note"])

    @patch("AI.fast_recommend._saved_recipes")
    @patch("AI.fast_recommend._online_meals")
    def test_reject_nonvegetarian_online_recipe(self, online, saved):
        saved.return_value = []
        online.return_value = [{"strMeal": "Egg Toast", "strIngredient1": "Egg",
            "strInstructions": "Cook", "idMeal": "23"}]
        self.assertEqual(get_fast_recipe_recommendations(self.cfg)["recipes"], [])

    @patch("AI.fast_recommend._saved_recipes")
    @patch("AI.fast_recommend._online_meals")
    def test_known_time_limit_respected(self, online, saved):
        online.return_value = []
        saved.return_value = self.saved
        self.cfg["preferences"]["cooking_time"] = 20
        self.assertEqual(get_fast_recipe_recommendations(self.cfg)["recipes"], [])


if __name__ == "__main__":
    unittest.main()
