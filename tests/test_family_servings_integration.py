"""Attendance-to-planner/shortage/completion integration, isolated SQLite DB."""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FamilyServingIntegrationTests(unittest.TestCase):
    def test_effective_eaters_stock_shortages_and_completed_history(self):
        script = textwrap.dedent('''\
            import sys, types
            from fastapi import APIRouter
            mock_ai = types.ModuleType('AI.api_router')
            mock_ai.router = APIRouter()
            sys.modules['AI.api_router'] = mock_ai

            from datetime import date, timedelta
            from fastapi.testclient import TestClient
            from app import app
            from db import connection
            import json

            day = (date.today() + timedelta(days=-1)).isoformat()
            path = f'/api/plan/{day}/lunch'
            slot = f'/api/family/attendance/{day}/lunch'

            with TestClient(app) as client:
                with connection() as c:
                    r = c.execute('''"""'''
                        INSERT INTO recipes(name,category,tags,base_servings,
                          calories_per_serving,minutes,ingredients,steps)
                        VALUES(?,?,?,?,?,?,?,?)
                    '''"""''', ('Family Test Recipe', 'lunch', '[]', 2,
                           120, 15, json.dumps([['Family Test Grain', 100, 'g']]), '[]'))
                    recipe_id = r.lastrowid
                def meals():
                    r = client.get('/api/plan', params={'start':day,'days':1})
                    assert r.status_code == 200, r.text
                    return r.json()
                def need():
                    r = client.get('/api/stock-check', params={'start':day,'days':1})
                    assert r.status_code == 200, r.text
                    return next((x['required'] for x in r.json()['shopping']
                                 if x['name']=='Family Test Grain'), 0)

                assert client.put(path, json={'recipe_id':recipe_id,'eaters':4}).status_code==200
                assert meals()[0]['eaters']==4
                assert need()==200
                ayush=client.post('/api/family/members',json={'name':'Ayush'}).json()['id']
                dhruv=client.post('/api/family/members',json={'name':'Dhruv'}).json()['id']
                # No implicit opt-in. Legacy plan remains unchanged.
                assert meals()[0]['eaters']==4
                assert need()==200
                assert client.put('/api/family/config',json={'attendance_enabled':True}).status_code==200
                assert meals()[0]['eaters']==2
                assert meals()[0]['saved_eaters']==4
                assert need()==100
                assert client.put(slot,json={'member_ids':[ayush]}).status_code==200
                assert meals()[0]['eaters']==1
                assert need()==50
                assert client.put(slot,json={'member_ids':[]}).status_code==200
                assert meals()[0]['eaters']==0
                assert need()==0
                not_cooked=client.post(path+'/complete')
                assert not_cooked.status_code==409, not_cooked.text
                with connection() as c:
                    assert c.execute('SELECT completed_at FROM meal_plan WHERE meal_date=? AND meal_type=?',(day,'lunch')).fetchone()[0] is None
                assert client.delete(slot).status_code==200
                assert meals()[0]['eaters']==2
                assert need()==100
                # Give exactly sufficient ingredient stock to check the cooking path.
                with connection() as c:
                    r=c.execute('INSERT INTO stock(name, quantity, unit) VALUES(?,?,?)', ('Family Test Grain',100.0,'g'))
                    c.execute('INSERT INTO stock_batches(stock_id,quantity,date_type) VALUES(?,?,?)',(r.lastrowid,100.0,'unknown'))
                cooked=client.post(path+'/complete')
                assert cooked.status_code==200, cooked.text
                assert cooked.json()['deducted'][0]['quantity']==100
                assert meals()[0]['eaters']==2
                # History is fixed even after attendance switches to zero.
                assert client.put(slot,json={'member_ids':[]}).status_code==200
                assert meals()[0]['eaters']==2
                assert need()==0
                with connection() as c:
                    plan=c.execute('SELECT eaters, completed_at FROM meal_plan WHERE meal_date=? AND meal_type=?',(day,'lunch')).fetchone()
                    assert plan['eaters']==2 and plan['completed_at']
                    physical=c.execute('SELECT quantity FROM stock_batches WHERE stock_id=(SELECT id FROM stock WHERE name=?)',('Family Test Grain',)).fetchone()[0]
                    assert physical==0
                assert client.get('/api/settings').json()['household_size']==4
                assert client.post(path+'/complete').status_code==409
            print('family_servings_integration_ok')
        ''')
        with tempfile.TemporaryDirectory() as temp:
            env = os.environ.copy()
            env['KITCHENSYNC_DB'] = str(Path(temp) / 'family-servings.sqlite3')
            env['PYTHONPATH'] = str(ROOT / 'backend') + os.pathsep + env.get('PYTHONPATH', '')
            result = subprocess.run([sys.executable, '-c', script], cwd=ROOT,
                                    env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
            self.assertIn('family_servings_integration_ok', result.stdout)

if __name__=='__main__':
    unittest.main()
