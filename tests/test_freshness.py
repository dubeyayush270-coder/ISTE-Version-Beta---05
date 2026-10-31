
"""
KitchenSync Phase 6.6 — Intelligent Freshness Tests

Run:
python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import unittest

from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


class FreshnessAPITests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
        except ImportError:
            raise unittest.SkipTest(
                "FastAPI/httpx test client not installed"
            )

        # Preserve the original database configuration.
        cls.original_db = os.environ.get("KITCHENSYNC_DB")

        # Create an isolated temporary database.
        cls.temp_dir = tempfile.TemporaryDirectory()

        os.environ["KITCHENSYNC_DB"] = str(
            Path(cls.temp_dir.name) / "freshness_test.sqlite3"
        )

        # Reload database and API modules for isolation.
        sys.modules.pop("app", None)
        sys.modules.pop("db", None)

        from app import app

        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        try:
            if hasattr(cls, "context"):
                cls.context.__exit__(None, None, None)
        finally:
            # Restore the environment for other tests.
            if cls.original_db is None:
                os.environ.pop("KITCHENSYNC_DB", None)
            else:
                os.environ["KITCHENSYNC_DB"] = cls.original_db

            sys.modules.pop("app", None)
            sys.modules.pop("db", None)

            if hasattr(cls, "temp_dir"):
                cls.temp_dir.cleanup()

    def test_all_freshness_date_types(self):
        date_types = [
            "expiry",
            "use_by",
            "best_before",
            "estimated",
            "unknown",
        ]

        today = date.today()

        # Create five future-date and five past-date batches.
        for date_type in date_types:
            for label, offset in [
                ("upcoming", 2),
                ("past", -2),
            ]:
                name = f"Phase66 {date_type} {label}"

                response = self.client.post(
                    "/api/inventory",
                    json={
                        "name": name,
                        "quantity": 100,
                        "unit": "g",
                        "expiry_date": (
                            today + timedelta(days=offset)
                        ).isoformat(),
                        "date_type": date_type,
                        "date_source": "manual",
                    },
                )

                self.assertEqual(
                    response.status_code,
                    201,
                    response.text,
                )

        # Request the real Dashboard endpoint.
        response = self.client.get("/api/dashboard")

        self.assertEqual(response.status_code, 200)

        dashboard = response.json()

        self.assertIsInstance(dashboard, dict)

        # Only inspect records created by this test.
        upcoming = [
            alert
            for alert in dashboard["expiring_soon"]
            if alert["name"].startswith("Phase66 ")
        ]

        past = [
            alert
            for alert in dashboard["expired_or_unsafe"]
            if alert["name"].startswith("Phase66 ")
        ]

        self.assertEqual(len(upcoming), 5)
        self.assertEqual(len(past), 5)

        for date_type in date_types:
            upcoming_name = f"Phase66 {date_type} upcoming"
            past_name = f"Phase66 {date_type} past"

            upcoming_matches = [
                alert for alert in upcoming
                if alert["name"] == upcoming_name
            ]

            past_matches = [
                alert for alert in past
                if alert["name"] == past_name
            ]

            self.assertEqual(len(upcoming_matches), 1)
            self.assertEqual(len(past_matches), 1)

            future_alert = upcoming_matches[0]
            past_alert = past_matches[0]

            self.assertEqual(
                future_alert["days_until_date"], 2
            )

            self.assertEqual(
                past_alert["days_until_date"], -2
            )

            self.assertEqual(
                future_alert["date_type"], date_type
            )

            self.assertEqual(
                past_alert["date_type"], date_type
            )

            self.assertEqual(
                future_alert["alert_code"],
                "approaching_recorded_date",
            )

            self.assertEqual(
                past_alert["alert_code"],
                "past_recorded_date",
            )

            self.assertTrue(future_alert["alert_message"])
            self.assertTrue(past_alert["alert_message"])

            self.assertTrue(future_alert["usable"])
            self.assertFalse(past_alert["usable"])

        # Check that every batch appears only once.
        all_ids = [
            alert["batch_id"]
            for alert in upcoming + past
        ]

        self.assertEqual(
            len(all_ids),
            len(set(all_ids)),
            "Duplicate batch freshness alerts found",
        )

        # Ensure expired and upcoming categories do not overlap.
        upcoming_ids = {
            alert["batch_id"] for alert in upcoming
        }

        past_ids = {
            alert["batch_id"] for alert in past
        }

        self.assertFalse(
            upcoming_ids & past_ids,
            "A batch appears in both alert categories",
        )

        # Verify important safety/quality distinctions.
        use_by_past = next(
            alert for alert in past
            if alert["date_type"] == "use_by"
        )

        best_before_past = next(
            alert for alert in past
            if alert["date_type"] == "best_before"
        )

        self.assertIn(
            "Do not consume",
            use_by_past["alert_message"],
        )

        self.assertIn(
            "Review product quality",
            best_before_past["alert_message"],
        )


if __name__ == "__main__":
    unittest.main()
