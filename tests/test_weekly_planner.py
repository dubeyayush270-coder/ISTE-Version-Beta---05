"""Weekly planning algorithm and API-handler tests using disposable SQLite.

The request models and real route handlers are exercised synchronously; this
also works where local socket restrictions prevent Starlette's TestClient.
"""
from collections import Counter
from datetime import date, datetime, timedelta
from importlib import import_module
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from weekly_planner import PlanningError, generate_week, replace_meal


def recipe(identifier, category, ingredient="Rice", minutes=20):
    return {"id": identifier, "name": f"Dish {identifier}", "category": category,
            "base_servings": 2, "minutes": minutes, "ingredients": [[ingredient, 100, "g"]]}


def library():
    return [recipe(index * 3 + alternative, kind)
            for index, kind in enumerate(("Breakfast", "Lunch", "Dinner"))
            for alternative in (1, 2, 3)]


def stock(name="Rice", quantity=10000, **extra):
    return {"name": name, "quantity": quantity, "unit": "g", "is_leftover": 0,
            "expiry_date": None, **extra}


class WeeklyAlgorithmTests(unittest.TestCase):
    def generate(self, recipes=None, pantry=None, **kwargs):
        return generate_week(date.today(), library() if recipes is None else recipes,
                             [stock()] if pantry is None else pantry, kwargs.pop("existing", []),
                             kwargs.pop("size", 4), kwargs.pop("preferences", {}), **kwargs)

    def test_21_slots_and_correct_categories_and_servings(self):
        result = self.generate(size=6)
        self.assertEqual(len(result["meals"]), 21)
        self.assertEqual(len({(m["meal_date"], m["meal_type"]) for m in result["meals"]}), 21)
        self.assertTrue(all(m["category"].casefold() == m["meal_type"] and m["eaters"] == 6
                            for m in result["meals"]))

    def test_empty_library_and_missing_category_report_error(self):
        for recipes in ([], [r for r in library() if r["category"] != "Dinner"]):
            with self.subTest(recipes=recipes), self.assertRaises(PlanningError):
                self.generate(recipes=recipes)

    def test_limited_variety_completes_with_notice(self):
        result = self.generate(recipes=[recipe(1, "Breakfast"), recipe(2, "Lunch"), recipe(3, "Dinner")])
        self.assertEqual(len(result["meals"]), 21)
        self.assertEqual(len(result["notices"]), 3)
        self.assertTrue(all(count == 7 for count in Counter(m["recipe_id"] for m in result["meals"]).values()))

    def test_repetition_is_balanced_and_no_adjacent_same_slot_repeat(self):
        meals = self.generate()["meals"]
        for kind in ("breakfast", "lunch", "dinner"):
            ids = [m["recipe_id"] for m in meals if m["meal_type"] == kind]
            counts = Counter(ids).values()
            self.assertLessEqual(max(counts) - min(counts), 1)
            self.assertTrue(all(left != right for left, right in zip(ids, ids[1:])))

    def test_supported_vegetarian_and_alias_exclusions(self):
        recipes = library()
        recipes[0]["ingredients"] = [["Eggs", 1, "pcs"]]
        recipes[1]["ingredients"] = [["Groundnuts", 20, "g"]]
        recipes[2]["ingredients"] = [["Eggplant", 100, "g"]]
        result = self.generate(recipes=recipes, preferences={"food_type": "vegetarian", "exclude": ["peanut"]})
        self.assertEqual({m["recipe_id"] for m in result["meals"] if m["meal_type"] == "breakfast"}, {3})

    def test_time_limit_filters_and_does_not_silently_relax(self):
        recipes = library()
        recipes[0]["minutes"] = 60
        result = self.generate(recipes=recipes, preferences={"max_minutes": 30})
        self.assertNotIn(1, [m["recipe_id"] for m in result["meals"]])
        with self.assertRaises(PlanningError):
            self.generate(preferences={"max_minutes": 5})

    def test_usable_stock_is_preferred_expired_and_wrong_units_ignored(self):
        recipes = library()
        recipes[0]["ingredients"] = [["Expired Rice", 100, "g"]]
        recipes[1]["ingredients"] = [["Wrong Unit", 100, "g"]]
        recipes[2]["ingredients"] = [["Fresh Rice", 100, "g"]]
        pantry = [stock("Expired Rice", expiry_date=(date.today() - timedelta(days=1)).isoformat()),
                  stock("Wrong Unit", unit="ml"), stock("Fresh Rice")]
        self.assertEqual(self.generate(recipes=recipes, pantry=pantry)["meals"][0]["recipe_id"], 3)

    def test_near_expiry_usable_batch_preferred(self):
        recipes = library()
        for item in recipes[:3]:
            item["ingredients"] = [[f"Ingredient {item['id']}", 100, "g"]]
        pantry = [stock(f"Ingredient {index}", batches=[{
            "id": index, "quantity": 1000,
            "expiry_date": (date.today() + timedelta(days=1 if index == 2 else 20)).isoformat(),
        }]) for index in (1, 2, 3)]
        self.assertEqual(self.generate(recipes=recipes, pantry=pantry)["meals"][0]["recipe_id"], 2)

    def test_future_purchases_and_unsafe_leftovers_not_counted(self):
        recipes = library()
        recipes[0]["ingredients"] = [["Rice", 100, "g"]]
        for item in recipes[1:3]:
            item["ingredients"] = [["Missing", 100, "g"]]
        future = stock(batches=[{"id": 1, "quantity": 10000, "expiry_date": None,
                               "purchase_date": (date.today() + timedelta(days=2)).isoformat()}])
        unsafe = stock(is_leftover=1, storage="room_temperature", prepared_at=datetime.now().isoformat())
        for pantry in ([future], [unsafe]):
            result = self.generate(recipes=recipes, pantry=pantry)
            first = result["meals"][0]
            self.assertTrue(any(w["date"] == first["meal_date"] and w["meal_type"] == "breakfast"
                                for w in result["audit"]["warnings"]))

    def test_pantry_is_allocated_once_and_not_mutated(self):
        pantry = [stock(quantity=100)]
        before = json.dumps(pantry, sort_keys=True)
        result = self.generate(pantry=pantry, size=2)
        self.assertEqual(result["audit"]["shopping"][0]["required"], 2100)
        self.assertEqual(result["audit"]["shopping"][0]["missing"], 2000)
        self.assertEqual(json.dumps(pantry, sort_keys=True), before)

    def test_regeneration_is_seeded_and_replacement_changes_only_one_slot(self):
        first = self.generate(seed=1)["meals"]
        self.assertEqual(first, self.generate(seed=1)["meals"])
        self.assertNotEqual(first, self.generate(seed=42)["meals"])
        target = first[0]
        result = replace_meal(date.today(), first, (target["meal_date"], target["meal_type"]),
                              library(), [stock()], {}, seed=3)
        self.assertNotEqual(first[0]["recipe_id"], result["meals"][0]["recipe_id"])
        self.assertEqual(first[1:], result["meals"][1:])
        self.assertTrue(all(m["recipe_name"] and m["category"] for m in result["meals"]))

    def test_completed_meal_is_preserved_and_serving_resolver_is_reused(self):
        completed = {"id": 10, "meal_date": date.today().isoformat(), "meal_type": "breakfast",
                     "recipe_id": 1, "eaters": 2, "completed_at": "2026-11-01T08:00:00"}
        result = self.generate(existing=[completed], eaters_for_slot=lambda day, kind: 3 if kind == "lunch" else 5)
        self.assertEqual(result["meals"][0]["eaters"], 2)
        self.assertEqual(result["meals"][0]["completed_at"], completed["completed_at"])
        self.assertTrue(all(m["eaters"] == 3 for m in result["meals"] if m["meal_type"] == "lunch"))
        with self.assertRaises(PlanningError):
            replace_meal(date.today(), result["meals"], (completed["meal_date"], "breakfast"),
                         library(), [stock()], {})


class WeeklyAPITests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="kitchensync-weekly-")
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "weekly.sqlite3"
        environment = patch.dict(os.environ, KITCHENSYNC_DB=str(self.path))
        environment.start()
        self.addCleanup(environment.stop)
        previous = {name: sys.modules.pop(name, None) for name in ("app", "db", "weekly_planner_api")}
        def restore():
            for name, module in previous.items():
                sys.modules.pop(name, None)
                if module is not None:
                    sys.modules[name] = module
        self.addCleanup(restore)
        self.db = import_module("db")
        self.assertEqual(self.db.DB_PATH.resolve(), self.path.resolve())
        self.app = import_module("app")
        self.api = import_module("weekly_planner_api")
        self.app.startup()
        self.start = date.today()
        self.body = {"start": self.start.isoformat(), "seed": 3}

    def preview(self, **extra):
        return self.api.suggest_week(self.api.WeekRequest(**{**self.body, **extra}))

    def save_body(self, preview, **extra):
        return {**self.body, "meals": preview["meals"], "expected_version": preview["expected_version"],
                "confirmed": True, "replace_existing": True, **extra}

    def save(self, body):
        return self.api.save_week(self.api.SaveRequest(**body))

    def snapshot(self):
        with self.db.connection() as c:
            return {table: [tuple(row) for row in c.execute(f"SELECT * FROM {table} ORDER BY id")]
                    for table in ("meal_plan", "stock", "stock_batches", "settings")}

    def assert_error(self, status, function):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as raised:
            function()
        self.assertEqual(raised.exception.status_code, status)

    def test_preview_regenerate_replace_and_cancel_do_not_write(self):
        before = self.snapshot()
        preview = self.preview()
        self.assertEqual(len(preview["meals"]), 21)
        self.preview(seed=4)
        result = self.api.replace_suggestion(self.api.ReplaceRequest(**{
            **self.save_body(preview), "target_date": self.start, "target_type": "breakfast"}))
        self.assertNotEqual(preview["meals"][0]["recipe_id"], result["meals"][0]["recipe_id"])
        self.assertEqual(self.snapshot(), before)  # Cancel requires no write/rollback endpoint.

    def test_save_persists_21_unique_slots_with_existing_request_format(self):
        preview = self.preview()
        before_stock = self.snapshot()["stock_batches"]
        result = self.save(self.save_body(preview))
        self.assertTrue(result["ok"])
        saved = self.app.get_plan(self.start, 7)
        self.assertEqual(len(saved), 21)
        self.assertEqual([(m["recipe_id"], m["eaters"]) for m in saved],
                         [(m["recipe_id"], m["eaters"]) for m in preview["meals"]])
        self.assertEqual(before_stock, self.snapshot()["stock_batches"])
        self.assertEqual(result["audit"], {k: v for k, v in self.app.stock_check(self.start, 7).items()
                                           if k in ("shopping", "warnings")})

    def test_completed_meals_preserved_and_tampering_rejected(self):
        with self.db.connection() as c:
            c.execute("UPDATE meal_plan SET completed_at='2026-11-01T08:00:00' WHERE meal_date=? AND meal_type='breakfast'",
                      (self.start.isoformat(),))
            before = dict(c.execute("SELECT * FROM meal_plan WHERE meal_date=? AND meal_type='breakfast'", (self.start.isoformat(),)).fetchone())
        preview = self.preview()
        changed = self.save_body(preview)
        changed["meals"] = [dict(m) for m in preview["meals"]]
        changed["meals"][0]["eaters"] = 7
        self.assert_error(409, lambda: self.save(changed))
        result = self.save(self.save_body(preview))
        self.assertEqual(result["kept_completed"], 1)
        with self.db.connection() as c:
            after = dict(c.execute("SELECT * FROM meal_plan WHERE id=?", (before["id"],)).fetchone())
        self.assertEqual(before, after)

    def test_confirmation_and_existing_selection_warning_are_enforced(self):
        preview = self.preview()
        body = self.save_body(preview, confirmed=False)
        before = self.snapshot()
        self.assert_error(422, lambda: self.save(body))
        # Change an existing open meal's serving count to require overwrite approval.
        body = self.save_body(preview, replace_existing=False)
        body["meals"] = [dict(m) for m in preview["meals"]]
        body["meals"][0]["eaters"] = 5
        self.assert_error(422, lambda: self.save(body))
        self.assertEqual(before, self.snapshot())

    def test_stale_plan_household_or_newly_completed_meal_rejected_without_writes(self):
        for mutation in (
            "UPDATE meal_plan SET eaters=8 WHERE meal_type='breakfast'",
            "UPDATE settings SET household_size=6 WHERE id=1",
            "UPDATE meal_plan SET completed_at='2026-11-01T09:00:00' WHERE meal_type='breakfast'",
        ):
            with self.subTest(mutation=mutation):
                preview = self.preview()
                with self.db.connection() as c:
                    c.execute(mutation)
                before = self.snapshot()
                self.assert_error(409, lambda: self.save(self.save_body(preview)))
                self.assertEqual(before, self.snapshot())

    def test_invalid_duplicate_wrong_category_missing_recipe_and_servings_rejected(self):
        preview = self.preview()
        baseline = self.snapshot()
        for mutation in ("duplicate", "category", "recipe", "count", "outside"):
            with self.subTest(mutation=mutation):
                body = self.save_body(preview)
                body["meals"] = [dict(m) for m in preview["meals"]]
                if mutation == "duplicate": body["meals"][0] = dict(body["meals"][1])
                elif mutation == "category": body["meals"][0]["recipe_id"] = body["meals"][1]["recipe_id"]
                elif mutation == "recipe": body["meals"][0]["recipe_id"] = 999999
                elif mutation == "count": body["meals"] = body["meals"][:-1]
                else: body["meals"][0]["meal_date"] = (self.start - timedelta(days=1)).isoformat()
                from pydantic import ValidationError
                try:
                    self.assert_error(422, lambda: self.save(body))
                except ValidationError:
                    self.assertEqual(mutation, "count")
                self.assertEqual(self.snapshot(), baseline)
        from pydantic import ValidationError
        for value in (0, 31):
            with self.assertRaises(ValidationError):
                self.api.SuggestedMeal(meal_date=self.start, meal_type="breakfast", recipe_id=1, eaters=value)

    def test_dietary_filter_is_revalidated_on_save(self):
        preview = self.preview()
        body = self.save_body(preview, preferences={"exclude": ["Onion"]})
        before = self.snapshot()
        self.assert_error(422, lambda: self.save(body))
        self.assertEqual(before, self.snapshot())

    def test_database_error_rolls_back_entire_week(self):
        preview = self.preview()
        with self.db.connection() as c:
            c.execute("""CREATE TRIGGER fail_week BEFORE INSERT ON meal_plan
                WHEN NEW.meal_type='dinner' BEGIN SELECT RAISE(ABORT,'test failure'); END""")
        before = self.snapshot()
        self.assert_error(500, lambda: self.save(self.save_body(preview)))
        self.assertEqual(before, self.snapshot())

    def test_retry_after_success_is_conflict_and_creates_no_duplicates(self):
        preview = self.preview()
        body = self.save_body(preview)
        self.save(body)
        before = self.snapshot()
        self.assert_error(409, lambda: self.save(body))
        self.assertEqual(before, self.snapshot())

    def test_empty_library_and_restrictive_filters_return_useful_errors(self):
        self.assert_error(422, lambda: self.preview(preferences={"max_minutes": 1}))
        with self.db.connection() as c:
            c.execute("DELETE FROM meal_plan")
            c.execute("DELETE FROM recipes")
        self.assert_error(422, self.preview)

    def test_existing_individual_meal_endpoint_and_completion_still_work(self):
        self.save(self.save_body(self.preview()))
        rice = next(r for r in self.app.recipes() if r["name"] == "Dal Rice")
        self.app.set_meal(self.start, "lunch", self.app.MealInput(recipe_id=rice["id"], eaters=1))
        before = self.snapshot()["stock_batches"]
        self.app.complete_meal(self.start, "lunch")
        self.assertNotEqual(before, self.snapshot()["stock_batches"])
        after = self.snapshot()
        self.assert_error(409, lambda: self.app.complete_meal(self.start, "lunch"))
        self.assertEqual(after, self.snapshot())

    def test_routes_registered_and_default_household_size_used(self):
        paths = set(self.app.app.openapi()["paths"])
        self.assertTrue({"/api/plan/suggestions", "/api/plan/suggestions/replace", "/api/plan/week"} <= paths)
        with self.db.connection() as c:
            c.execute("UPDATE settings SET household_size=7 WHERE id=1")
        self.assertTrue(all(meal["eaters"] == 7 for meal in self.preview()["meals"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
