
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from AI.validate_recipe import validate_recipe


class DietaryValidationTests(unittest.TestCase):

    def check_recipe(self, ingredients, preferences):
        recipe = {
            "title": "Test Recipe",
            "ingredients": ingredients,
            "instructions": ["Mix ingredients and cook."],
            "cooking_time": "PT15M",
        }
        return validate_recipe(recipe, preferences)

    def test_eggs_rejected_for_vegetarian(self):
        result = self.check_recipe(
            ["2 eggs", "onion"],
            {"food_type": "vegetarian"},
        )
        self.assertFalse(result["is_valid"])

    def test_eggplant_is_vegetarian(self):
        result = self.check_recipe(
            ["eggplant", "tomato"],
            {"food_type": "vegetarian"},
        )
        self.assertTrue(result["is_valid"])

    def test_peanuts_match_peanut_exclusion(self):
        result = self.check_recipe(
            ["100 g peanuts", "rice"],
            {"exclude": ["peanut"]},
        )
        self.assertFalse(result["is_valid"])

    def test_groundnut_matches_peanut_exclusion(self):
        result = self.check_recipe(
            ["groundnut oil", "rice"],
            {"exclude": ["peanut"]},
        )
        self.assertFalse(result["is_valid"])

    def test_plural_carrots_are_excluded(self):
        result = self.check_recipe(
            ["carrots", "bread"],
            {"exclude": ["carrot"]},
        )
        self.assertFalse(result["is_valid"])

    def test_safe_recipe_remains_eligible(self):
        result = self.check_recipe(
            ["paneer", "rice", "tomato"],
            {
                "food_type": "vegetarian",
                "exclude": ["peanut"],
            },
        )
        self.assertTrue(result["is_valid"])


if __name__ == "__main__":
    unittest.main()
