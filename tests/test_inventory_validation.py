
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


class InventoryValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.previous_db = os.environ.get("KITCHENSYNC_DB")
        cls.temp_dir = tempfile.TemporaryDirectory()

        os.environ["KITCHENSYNC_DB"] = str(
            Path(cls.temp_dir.name) / "validation.sqlite3"
        )

        for module in ("app", "db"):
            sys.modules.pop(module, None)

        from app import app

        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.context.__exit__(None, None, None)
        finally:
            if cls.previous_db is None:
                os.environ.pop("KITCHENSYNC_DB", None)
            else:
                os.environ["KITCHENSYNC_DB"] = cls.previous_db

            for module in ("app", "db"):
                sys.modules.pop(module, None)

            cls.temp_dir.cleanup()

    def create_stock(self, name, quantity=100, unit="g"):
        response = self.client.post(
            "/api/inventory",
            json={
                "name": name,
                "quantity": quantity,
                "unit": unit,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)

        inventory = self.client.get("/api/inventory").json()
        return next(item for item in inventory if item["name"] == name)

    def test_blank_name_rejected_on_create(self):
        response = self.client.post(
            "/api/inventory",
            json={"name": "   ", "quantity": 100, "unit": "g"},
        )
        self.assertEqual(response.status_code, 422)

    def test_blank_name_rejected_on_edit(self):
        item = self.create_stock("Blank Edit Test")

        response = self.client.put(
            f"/api/inventory/{item['id']}",
            json={"name": "   ", "quantity": 100, "unit": "g"},
        )
        self.assertEqual(response.status_code, 422)

    def test_unit_change_rejected_without_data_loss(self):
        item = self.create_stock("Unit Change Test", 250, "g")

        response = self.client.put(
            f"/api/inventory/{item['id']}",
            json={
                "name": "Unit Change Test",
                "quantity": 250,
                "unit": "ml",
            },
        )
        self.assertEqual(response.status_code, 409)

        after = next(
            item for item in self.client.get("/api/inventory").json()
            if item["name"] == "Unit Change Test"
        )
        self.assertEqual(after["unit"], "g")
        self.assertEqual(after["quantity"], 250)

    def test_quantity_edit_with_same_unit_succeeds(self):
        item = self.create_stock("Quantity Edit Test", 100, "g")

        response = self.client.put(
            f"/api/inventory/{item['id']}",
            json={
                "name": "Quantity Edit Test",
                "quantity": 200,
                "unit": "g",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)

        after = next(
            item for item in self.client.get("/api/inventory").json()
            if item["name"] == "Quantity Edit Test"
        )
        self.assertEqual(after["quantity"], 200)


if __name__ == "__main__":
    unittest.main()
