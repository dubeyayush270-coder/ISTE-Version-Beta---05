"""Isolated API tests for fitness metadata and unlocked regeneration."""
import os, sys, tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from datetime import date
from importlib import import_module

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))

class NutritionAPITests(TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory(prefix='ks-nutrition-')
        self.addCleanup(directory.cleanup)
        self.path=Path(directory.name)/'test.sqlite3'
        env=patch.dict(os.environ,{'KITCHENSYNC_DB':str(self.path)})
        env.start();self.addCleanup(env.stop)
        previous={x:sys.modules.pop(x,None) for x in ('db','app','weekly_planner_api','recipe_nutrition_api')}
        def restore():
            for k,v in previous.items():
                sys.modules.pop(k,None)
                if v is not None:sys.modules[k]=v
        self.addCleanup(restore)
        self.db=import_module('db')
        self.app=import_module('app')
        self.api=import_module('weekly_planner_api')
        self.app.startup()

    def test_per_serving_macro_update_and_weekly_preview(self):
        with self.db.connection() as c:
            recipe_id=c.execute('SELECT id FROM recipes WHERE name=?',('Vegetable Poha',)).fetchone()['id']
        from recipe_nutrition_api import update_recipe_nutrition,NutritionUpdate
        result=update_recipe_nutrition(recipe_id,NutritionUpdate(
            calories_per_serving=300,protein_g_per_serving=15,
            carbs_g_per_serving=42,fat_g_per_serving=7))
        self.assertTrue(result['ok'])
        preview=self.api.suggest_week(self.api.WeekRequest(start=date.today(),
              preferences={'nutrition_goal':'high_protein'}))
        self.assertEqual(len(preview['meals']),21)
        self.assertIn('daily_nutrition',preview)
        poha=next((m for m in preview['meals'] if m['recipe_id']==recipe_id),None)
        if poha:
            self.assertEqual(poha['nutrition']['protein_g'],15)
            self.assertEqual(poha['nutrition']['carbs_g'],42)

    def test_regeneration_pins_meals_and_does_not_write(self):
        start=date.today()
        preview=self.api.suggest_week(self.api.WeekRequest(start=start))
        with self.db.connection() as c:
            count_before=c.execute('SELECT COUNT(*) FROM meal_plan').fetchone()[0]
        chosen=preview['meals'][1]
        request=self.api.RegenerateRequest(start=start, expected_version=preview['expected_version'],
            seed=42, meals=preview['meals'], locked_slots=[{'meal_date':chosen['meal_date'],
                                                           'meal_type':chosen['meal_type']}])
        fresh=self.api.regenerate_unlocked(request)
        kept=next(m for m in fresh['meals'] if (m['meal_date'],m['meal_type']) ==
                  (chosen['meal_date'],chosen['meal_type']))
        self.assertEqual((kept['recipe_id'],kept['eaters']),
                         (chosen['recipe_id'],chosen['eaters']))
        with self.db.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM meal_plan').fetchone()[0],count_before)

    def test_day_specific_minutes_are_respected(self):
        start=date.today()
        preview=self.api.suggest_week(self.api.WeekRequest(start=start,
            preferences={'weekday_minutes':45,'weekend_minutes':90}))
        for m in preview['meals']:
            limit=90 if date.fromisoformat(m['meal_date']).weekday()>=5 else 45
            self.assertLessEqual(m['minutes'],limit)


class OnlineNutritionImportTests(TestCase):
    def test_source_measurement_parser_and_reviewed_macro_import(self):
        from online_recipes_api import _strict_measure, ImportRequest, import_online_recipe
        self.assertEqual(_strict_measure("12", "Cashew nuts"), (12, "pcs"))
        self.assertEqual(_strict_measure("½ tbsp", "Khus khus"), (7.5, "ml"))
        self.assertEqual(_strict_measure("1/2 kg", "Rice"), (500, "g"))
        self.assertEqual(_strict_measure("1 cup", "Rice"), (None, "g"))
        from unittest.mock import patch as mock_patch
        import online_recipes_api as online
        with tempfile.TemporaryDirectory() as folder:
            import db
            old = db.DB_PATH
            db.DB_PATH = Path(folder)/"online.sqlite3"
            try:
                db.init_db()
                source = {"idMeal":"12345","strMeal":"Test Rice Bowl","strArea":"Indian",
                          "strCategory":"Vegan","strMealThumb":"", "strInstructions":"Cook until done.",
                          "strIngredient1":"Rice", "strMeasure1":"200 g"}
                with mock_patch.object(online, "_get_details", return_value=source):
                    response=import_online_recipe(ImportRequest(meal_id="12345",category="lunch",
                        base_servings=2,minutes=25,confirmed=True,
                        calories_per_serving=300,protein_g_per_serving=8,carbs_g_per_serving=60,
                        fat_g_per_serving=2,ingredients=[{"name":"Rice","quantity":200,"unit":"g"}]))
                with db.connection() as c:
                    row=c.execute("SELECT * FROM recipes WHERE id=?",(response['recipe_id'],)).fetchone()
                    self.assertEqual(row['protein_g_per_serving'],8)
                    self.assertEqual(row['nutrition_source'],'user_entered')
                    self.assertEqual(row['base_servings'],2)
            finally:
                db.DB_PATH = old
