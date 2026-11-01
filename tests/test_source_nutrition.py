"""No-network tests for optional source nutrition previews."""
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from source_nutrition_api import extract_schema_nutrition, _validate_url, source_nutrition

FIXTURE = '''<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Example"},
{"@type":"Recipe","name":"Test Recipe","recipeYield":"4 servings",
"nutrition":{"@type":"NutritionInformation","calories":"544 kcal",
"proteinContent":"35 g","carbohydrateContent":"18 g","fatContent":"35 g"}}]}
</script></head></html>'''

class SourceNutritionTests(TestCase):
    def test_extracts_only_explicit_values(self):
        parsed = extract_schema_nutrition(FIXTURE)
        self.assertEqual(parsed["values"], {"calories_per_serving":544,
            "protein_g_per_serving":35,"carbs_g_per_serving":18,"fat_g_per_serving":35})
        self.assertEqual(parsed["recipe_yield"], "4 servings")

    def test_no_nutrition_returns_none(self):
        self.assertIsNone(extract_schema_nutrition('<script type="application/ld+json">{"@type":"Recipe"}</script>'))
        self.assertIsNone(extract_schema_nutrition('<script>console.log(2)</script>'))

    def test_missing_fields_stay_missing(self):
        body = '<script type="application/ld+json">{"@type":"Recipe","nutrition":{"proteinContent":"12 g"}}</script>'
        parsed=extract_schema_nutrition(body)
        self.assertIsNone(parsed["values"]["calories_per_serving"])
        self.assertEqual(parsed["values"]["protein_g_per_serving"],12)

    def test_rejects_arbitrary_urls_and_redirect_targets(self):
        for url in ('http://www.bbcgoodfood.com/recipes/test',
                    'https://www.bbcgoodfood.com.evil.org/recipes/test',
                    'https://127.0.0.1/recipes/test',
                    'https://www.bbcgoodfood.com:444/recipes/test',
                    'https://www.bbcgoodfood.com@127.0.0.1/recipes/test'):
            with self.subTest(url=url), self.assertRaises(HTTPException):
                _validate_url(url)

    def test_api_reads_only_provider_source_and_never_writes(self):
        with patch("source_nutrition_api._get_details", return_value={"idMeal":"555"}), \
             patch("source_nutrition_api._details", return_value={"source_url":"https://www.bbcgoodfood.com/recipes/test"}), \
             patch("source_nutrition_api._download_html", return_value=FIXTURE):
            result=source_nutrition("555")
        self.assertTrue(result["requires_review"])
        self.assertEqual(result["values"]["calories_per_serving"],544)
