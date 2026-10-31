
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from AI.config import create_user_configuration
from AI.recommend import get_recipe_recommendations


class RecommendationPipelineTests(unittest.TestCase):

    @patch("AI.process_recipe.extract_recipe")
    @patch("AI.recommend.search_recipes")
    def test_excluded_recipes_are_filtered(
        self, mock_search, mock_extract
    ):
        mock_search.return_value = [
            {
                "title": "Paneer Roll",
                "url": "https://example.test/good"
            },
            {
                "title": "Carrot Sandwich",
                "url": "https://example.test/bad"
            }
        ]

        def fake_extract(url):
            if url.endswith("/good"):
                title = "Paneer Roll"
                ingredients = ["paneer", "wheat flour"]
            else:
                title = "Carrot Sandwich"
                ingredients = ["bread", "carrot"]

            return {
                "url": url,
                "recipes": [{
                    "title": title,
                    "ingredients": ingredients,
                    "instructions": ["Prepare ingredients", "Cook"],
                    "cooking_time": "PT15M"
                }]
            }

        mock_extract.side_effect = fake_extract

        config = create_user_configuration(
            "kids_tiffin",
            {
                "food_type": "vegetarian",
                "exclude": ["carrot", "onion"],
                "cooking_time": 20
            }
        )

        result = get_recipe_recommendations(config)

        self.assertEqual(len(result["recipes"]), 1)
        self.assertEqual(
            result["recipes"][0]["title"],
            "Paneer Roll"
        )
        self.assertEqual(mock_extract.call_count, 2)


if __name__ == "__main__":
    unittest.main()
