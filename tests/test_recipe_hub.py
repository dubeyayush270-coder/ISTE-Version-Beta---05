"""Recipe Hub API regression tests, independent of optional live-search dependencies."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

class RecipeHubTests(unittest.TestCase):
    def setUp(self):
        import db
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from recipe_hub_api import router
        self.temp = tempfile.TemporaryDirectory()
        self.previous = db.DB_PATH
        db.DB_PATH = Path(self.temp.name) / 'hub-test.sqlite3'
        db.init_db()
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        with db.connection() as c:
            self.original = c.execute('SELECT * FROM recipes WHERE name=?', ('Dal Rice',)).fetchone()['id']
            self.stock_before = [tuple(r) for r in c.execute('SELECT * FROM stock ORDER BY id')]
            self.plan_before = [tuple(r) for r in c.execute('SELECT * FROM meal_plan ORDER BY id')]

    def tearDown(self):
        import db
        db.DB_PATH = self.previous
        self.client.close()
        self.temp.cleanup()

    def test_profile_roundtrip_and_overview(self):
        response = self.client.put(f'/api/recipe-hub/recipes/{self.original}/profile', json={
            'favorite':True, 'rating':5, 'notes':'Add lemon', 'collections':['Family favorites','Quick']
        })
        self.assertEqual(response.status_code, 200, response.text)
        overview = self.client.get('/api/recipe-hub/overview').json()
        profile = overview['profiles'][str(self.original)]
        self.assertTrue(profile['favorite'])
        self.assertEqual(profile['rating'],5)
        self.assertEqual(profile['collections'],['Family favorites','Quick'])

    def test_copy_is_new_and_does_not_change_original_or_pantry(self):
        body = dict(name='My Lemon Dal Rice',category='lunch',base_servings=3,minutes=25,
            ingredients=[{'name':'Rice','quantity':200,'unit':'g'}, {'name':'Lemon','quantity':1,'unit':'pcs'}],
            steps=['Cook the rice','Add lemon at end'],tags=['personal'])
        res=self.client.post(f'/api/recipe-hub/recipes/{self.original}/copy',json=body)
        self.assertEqual(res.status_code,201,res.text)
        self.assertNotEqual(res.json()['recipe_id'],self.original)
        import db
        with db.connection() as c:
            self.assertEqual(c.execute('SELECT name FROM recipes WHERE id=?',(self.original,)).fetchone()['name'],'Dal Rice')
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM stock ORDER BY id')],self.stock_before)
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM meal_plan ORDER BY id')],self.plan_before)
        self.assertEqual(self.client.post(f'/api/recipe-hub/recipes/{self.original}/copy',json=body).status_code,409)

    def test_validation_unknown_recipe_and_prices(self):
        self.assertEqual(self.client.put('/api/recipe-hub/recipes/99999/profile',json={}).status_code,404)
        self.assertEqual(self.client.post(f'/api/recipe-hub/recipes/{self.original}/copy',json={
            'name':'Bad','category':'lunch','base_servings':2,'minutes':30,
            'ingredients':[{'name':'Lemon','quantity':0.5,'unit':'pcs'}],'steps':['Cook']
        }).status_code,422)
        self.assertEqual(self.client.put('/api/recipe-hub/prices',json={
            'ingredient':'Rice','unit':'g','price_per_unit':0.12
        }).status_code,200)
        entry=self.client.get('/api/recipe-hub/overview').json()['prices'][0]
        self.assertEqual(entry['ingredient_key'],'rice')
        self.assertAlmostEqual(entry['price_per_unit'],0.12)

    def test_online_import_preserves_source_and_image(self):
        from unittest.mock import patch
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from online_recipes_api import router as online_router
        app=FastAPI()
        app.include_router(online_router)
        meal={
            'idMeal':'52772', 'strMeal':'Example Paneer Dish',
            'strCategory':'Vegetarian','strArea':'Indian',
            'strMealThumb':'https://www.themealdb.com/images/media/meals/example.jpg',
            'strSource':'https://www.themealdb.com/meal/52772',
            'strInstructions':'Cook paneer.\nServe.', 'strIngredient1':'Paneer',
            'strMeasure1':'200 g',
        }
        with patch('online_recipes_api._get_details',return_value=meal):
            with TestClient(app) as client:
                r=client.post('/api/recipes/online/import',json={
                    'meal_id':'52772','category':'lunch','base_servings':2,
                    'minutes':20,'confirmed':True,
                    'ingredients':[{'name':'Paneer','quantity':200,'unit':'g'}]
                })
                self.assertEqual(r.status_code,201,r.text)
        import db
        with db.connection() as c:
            row=c.execute('SELECT source_url,image_url FROM recipes WHERE id=?',(r.json()['recipe_id'],)).fetchone()
            self.assertTrue(row['source_url'].startswith('https://'))
            self.assertTrue(row['image_url'].startswith('https://'))

    def test_cooked_log_does_not_deduct_or_create_meal(self):
        res=self.client.post(f'/api/recipe-hub/recipes/{self.original}/cooked')
        self.assertEqual(res.status_code,201,res.text)
        self.assertTrue(res.json()['inventory_unchanged'])
        history=self.client.get('/api/recipe-hub/overview').json()['history']
        self.assertIn(self.original,[r['recipe_id'] for r in history])
        import db
        with db.connection() as c:
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM stock ORDER BY id')],self.stock_before)
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM meal_plan ORDER BY id')],self.plan_before)

if __name__=='__main__': unittest.main()
