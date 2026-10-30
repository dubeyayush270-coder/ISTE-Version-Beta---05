"""Run: python -m unittest discover -s tests -v"""
import os
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))

from core import scale_ingredients, stock_available, audit_meals


class CoreTests(unittest.TestCase):
    def test_dynamic_family_size(self):
        r={'base_servings':2,'ingredients':[['Rice',150,'g'],['Oil',20,'ml']]}
        self.assertEqual(scale_ingredients(r,3),[{'name':'Rice','quantity':225,'unit':'g'},{'name':'Oil','quantity':30,'unit':'ml'}])

    def test_expired_stock_is_not_usable(self):
        i={'expiry_date':(date.today()-timedelta(days=1)).isoformat(),'is_leftover':0}
        self.assertFalse(stock_available(i))

    def test_unsafe_leftover_not_usable(self):
        i={'is_leftover':1,'storage':'room_temperature','prepared_at':datetime.now().isoformat(),'expiry_date':None}
        self.assertFalse(stock_available(i))

    def test_weekly_shortages_consume_stock_only_once(self):
        r={'id':7,'name':'Dal rice','base_servings':2,'ingredients':[['Rice',150,'g']]}
        meals=[{'meal_date':'2026-10-30','meal_type':'lunch','eaters':2,'recipe_id':7,'completed_at':None},
               {'meal_date':'2026-10-31','meal_type':'lunch','eaters':2,'recipe_id':7,'completed_at':None}]
        stock=[{'name':'Rice','quantity':200,'unit':'g','expiry_date':None,'is_leftover':0}]
        audit=audit_meals(meals,{7:r},stock)
        self.assertEqual(audit['shopping'][0]['missing'],100)

    def test_completed_meal_does_not_request_stock_again(self):
        r={'id':1,'name':'Rice','base_servings':1,'ingredients':[['Rice',100,'g']]}
        meals=[{'meal_date':'2026-10-30','meal_type':'lunch','eaters':1,'recipe_id':1,'completed_at':'2026-10-30T12:00:00'}]
        self.assertEqual(audit_meals(meals,{1:r},[])['shopping'],[])


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
        except ImportError:
            raise unittest.SkipTest('FastAPI/httpx testclient not installed')
        cls.dir=tempfile.TemporaryDirectory()
        os.environ['KITCHENSYNC_DB']=str(Path(cls.dir.name)/'test.sqlite3')
        for module in ('db','app'):
            sys.modules.pop(module,None)
        from app import app
        cls.context=TestClient(app)
        cls.client=cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,'context'):cls.context.__exit__(None,None,None)
        if hasattr(cls,'dir'):cls.dir.cleanup()

    def test_demo_has_data(self):
        self.assertEqual(self.client.get('/api/health').json()['status'],'ok')
        self.assertGreaterEqual(len(self.client.get('/api/recipes').json()),8)

    def test_complete_once_and_deduct_once(self):
        today=date.today().isoformat()
        before={i['name']:i['quantity'] for i in self.client.get('/api/inventory').json()}
        r=self.client.post(f'/api/plan/{today}/breakfast/complete')
        self.assertEqual(r.status_code,200,r.text)
        after={i['name']:i['quantity'] for i in self.client.get('/api/inventory').json()}
        self.assertEqual(after['Poha'],before['Poha']-280)
        twice=self.client.post(f'/api/plan/{today}/breakfast/complete')
        self.assertEqual(twice.status_code,409)
        still={i['name']:i['quantity'] for i in self.client.get('/api/inventory').json()}
        self.assertEqual(after,still)

    def test_insufficient_stock_does_not_deduct(self):
        today=date.today().isoformat()
        before={i['name']:i['quantity'] for i in self.client.get('/api/inventory').json()}
        response=self.client.post(f'/api/plan/{today}/dinner/complete')
        self.assertEqual(response.status_code,409)
        after={i['name']:i['quantity'] for i in self.client.get('/api/inventory').json()}
        self.assertEqual(before,after)


if __name__=='__main__':
    unittest.main()
