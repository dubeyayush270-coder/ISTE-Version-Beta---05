"""Standalone tests: no application AI dependencies and no production DB writes."""

import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from family_management import init_family_schema, router


class FamilyManagementTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.db = importlib.import_module("db")
        self.db_patch = patch.object(self.db, "DB_PATH", Path(self.temporary.name) / "test.sqlite3")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        with self.db.connection() as c:
            c.execute("""
                CREATE TABLE settings (
                    id INTEGER PRIMARY KEY, household_name TEXT, household_size INTEGER
                )
            """)
            c.execute(
                "INSERT INTO settings VALUES (1, 'Original Household', 4)"
            )
        init_family_schema()
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def member(self, name, vegetarian=False):
        response = self.client.post(
            "/api/family/members", json={"name": name, "vegetarian": vegetarian}
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_schema_idempotent_and_legacy_settings_preserved(self):
        self.member("Asha")
        init_family_schema()
        with self.db.connection() as c:
            row = c.execute("SELECT * FROM settings WHERE id=1").fetchone()
            self.assertEqual((row["household_name"], row["household_size"]),
                             ("Original Household", 4))
        members = self.client.get("/api/family/members").json()
        self.assertEqual(len(members["members"]), 1)
        self.assertFalse(members["attendance_enabled"])

    def test_member_crud_validation_and_duplicate_names(self):
        member = self.member("  Asha  ", vegetarian=True)
        self.assertEqual(member["name"], "Asha")
        self.assertTrue(member["vegetarian"])
        self.assertEqual(self.client.post("/api/family/members", json={"name": "asha"}).status_code, 409)
        self.assertEqual(self.client.post("/api/family/members", json={"name": "  "}).status_code, 422)
        result = self.client.patch(f"/api/family/members/{member['id']}", json={"name": "Anya", "enabled": False})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["enabled"])
        self.assertEqual(self.client.patch(f"/api/family/members/{member['id']}", json={"name": None}).status_code, 422)
        self.assertEqual(self.client.delete(f"/api/family/members/{member['id']}").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/family/members/{member['id']}?confirmed=true").status_code, 200)
        self.assertEqual(self.client.get("/api/family/members").json()["members"], [])

    def test_legacy_mode_requires_explicit_enable(self):
        person = self.member("Asha")
        uri = "/api/family/attendance/2026-11-01/lunch"
        state = self.client.get(uri).json()
        self.assertEqual(state["effective_eaters"], 4)
        self.assertEqual(state["selected_member_ids"], [person["id"]])
        enabled = self.client.put("/api/family/config", json={"attendance_enabled": True})
        self.assertEqual(enabled.status_code, 200)
        self.assertEqual(self.client.get(uri).json()["effective_eaters"], 1)
        self.assertEqual(self.client.get(uri).json()["mode"], "default")

    def test_per_date_meal_override_and_zero_attendance(self):
        a = self.member("Asha")
        b = self.member("Ravi")
        self.client.put("/api/family/config", json={"attendance_enabled": True})
        lunch = "/api/family/attendance/2026-11-01/lunch"
        dinner = "/api/family/attendance/2026-11-01/dinner"
        tomorrow = "/api/family/attendance/2026-11-02/lunch"
        response = self.client.put(lunch, json={"member_ids": [b["id"]]})
        self.assertEqual(response.json()["effective_eaters"], 1)
        self.assertEqual(response.json()["mode"], "override")
        self.assertEqual(self.client.get(dinner).json()["effective_eaters"], 2)
        self.assertEqual(self.client.get(tomorrow).json()["effective_eaters"], 2)
        self.assertEqual(self.client.put(lunch, json={"member_ids": []}).json()["effective_eaters"], 0)
        self.assertEqual(self.client.get(lunch).json()["mode"], "override")
        self.assertEqual(self.client.delete(lunch).json()["effective_eaters"], 2)
        self.assertEqual(self.client.get(lunch).json()["mode"], "default")
        self.assertNotEqual(a["id"], b["id"])

    def test_disable_and_remove_member_update_roster(self):
        a = self.member("Asha")
        b = self.member("Ravi")
        self.client.put("/api/family/config", json={"attendance_enabled": True})
        slot = "/api/family/attendance/2026-11-01/breakfast"
        self.client.put(slot, json={"member_ids": [a["id"], b["id"]]})
        self.client.patch(f"/api/family/members/{b['id']}", json={"enabled": False})
        self.assertEqual(self.client.get(slot).json()["effective_eaters"], 1)
        self.assertEqual(self.client.put(slot, json={"member_ids": [b["id"]]}).status_code, 422)
        self.client.delete(f"/api/family/members/{a['id']}?confirmed=true")
        self.assertEqual(self.client.get(slot).json()["effective_eaters"], 0)

    def test_cannot_enable_empty_roster_or_invalid_attendance(self):
        self.assertEqual(self.client.put("/api/family/config", json={"attendance_enabled": True}).status_code, 409)
        a = self.member("Asha")
        self.assertEqual(self.client.get("/api/family/attendance/2026-11-01/snack").status_code, 422)
        slot = "/api/family/attendance/2026-11-01/lunch"
        self.assertEqual(self.client.put(slot, json={"member_ids": [a["id"], a["id"]]}).status_code, 422)
        self.assertEqual(self.client.put(slot, json={"member_ids": [99999]}).status_code, 422)
        self.assertEqual(self.client.get(slot).json()["has_override"], False)


if __name__ == "__main__":
    unittest.main()
