
"""Regression tests for future-date inventory planning."""

import os
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from core import audit_meals


class FutureStockCoreTests(unittest.TestCase):

    def audit(self, batches, meal_offsets):
        today = date.today()

        stock = [{
            "name": "Rice",
            "unit": "g",
            "quantity": sum(b["quantity"] for b in batches),
            "usable_quantity": sum(
                b["quantity"] for b in batches
            ),
            "is_leftover": 0,
            "expiry_date": None,
            "batches": batches,
        }]

        meals = [
            {
                "meal_date": (
                    today + timedelta(days=offset)
                ).isoformat(),
                "meal_type": "lunch",
                "eaters": 1,
                "recipe_id": 1,
                "completed_at": None,
            }
            for offset in meal_offsets
        ]

        recipes = {
            1: {
                "id": 1,
                "name": "Rice",
                "base_servings": 1,
                "ingredients": [["Rice", 100, "g"]],
            }
        }

        return audit_meals(
            meals, recipes, stock, today=today
        )

    def test_expired_before_meal_is_missing(self):
        result = self.audit(
            [{
                "id": 1,
                "quantity": 100,
                "expiry_date": (
                    date.today() + timedelta(days=1)
                ).isoformat(),
            }],
            [3],
        )

        self.assertEqual(
            result["shopping"][0]["missing"], 100
        )

    def test_fefo_preserves_later_batch(self):
        result = self.audit(
            [
                {
                    "id": 2,
                    "quantity": 100,
                    "expiry_date": (
                        date.today() + timedelta(days=6)
                    ).isoformat(),
                },
                {
                    "id": 1,
                    "quantity": 100,
                    "expiry_date": (
                        date.today() + timedelta(days=1)
                    ).isoformat(),
                },
            ],
            [0, 3],
        )

        self.assertEqual(result["shopping"], [])

    def test_future_purchase_is_not_available(self):
        result = self.audit(
            [{
                "id": 1,
                "quantity": 100,
                "expiry_date": None,
                "purchase_date": (
                    date.today() + timedelta(days=6)
                ).isoformat(),
            }],
            [3],
        )

        self.assertEqual(
            result["shopping"][0]["missing"], 100
        )


class FutureStockAPITests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.original_db = os.environ.get(
            "KITCHENSYNC_DB"
        )
        cls.temp_dir = tempfile.TemporaryDirectory()

        os.environ["KITCHENSYNC_DB"] = str(
            Path(cls.temp_dir.name) / "future.sqlite3"
        )

        for module in ("db", "app"):
            sys.modules.pop(module, None)

        from app import app

        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.context.__exit__(None, None, None)
        finally:
            if cls.original_db is None:
                os.environ.pop("KITCHENSYNC_DB", None)
            else:
                os.environ["KITCHENSYNC_DB"] = cls.original_db

            for module in ("db", "app"):
                sys.modules.pop(module, None)

            cls.temp_dir.cleanup()

    def test_stock_check_uses_meal_date(self):
        today = date.today()
        future = today + timedelta(days=5)

        recipes = self.client.get("/api/recipes").json()
        recipe = next(
            r for r in recipes
            if r["name"] == "Aloo Paratha"
        )

        response = self.client.put(
            f"/api/plan/{future.isoformat()}/breakfast",
            json={
                "recipe_id": recipe["id"],
                "eaters": 2,
            },
        )

        self.assertEqual(
            response.status_code, 200, response.text
        )

        from db import connection

        with connection() as c:
            c.execute(
                """
                UPDATE stock_batches
                SET expiry_date = ?
                WHERE stock_id = (
                    SELECT id FROM stock
                    WHERE name = ?
                )
                """,
                (
                    (
                        today + timedelta(days=1)
                    ).isoformat(),
                    "Wheat flour",
                ),
            )

        response = self.client.get(
            "/api/stock-check",
            params={
                "start": future.isoformat(),
                "days": 1,
            },
        )

        self.assertEqual(
            response.status_code, 200, response.text
        )

        alerts = [
            warning
            for warning in response.json()["warnings"]
            if warning["ingredient"] == "Wheat flour"
        ]

        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["missing"], 200)


if __name__ == "__main__":
    unittest.main()
