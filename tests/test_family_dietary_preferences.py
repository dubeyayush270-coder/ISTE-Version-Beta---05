# Four dietary choices and lossless migration from legacy vegetarian flags.
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from family_management import init_family_schema, router


class FamilyDietaryPreferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        dbmodule = importlib.import_module('db')
        self.db = dbmodule
        patcher = patch.object(dbmodule, 'DB_PATH', Path(self.tmp.name) / 'diet.sqlite3')
        patcher.start()
        self.addCleanup(patcher.stop)
        with dbmodule.connection() as c:
            c.execute('CREATE TABLE settings (id INTEGER PRIMARY KEY, household_name TEXT, household_size INTEGER)')
            c.execute("INSERT INTO settings VALUES(1, 'Family', 4)")
        init_family_schema()
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_four_choices_persist_and_update(self):
        for preference in ('vegetarian', 'non-vegetarian', 'eggitarian', 'vegan'):
            response = self.client.post('/api/family/members', json={
                'name': preference, 'dietary_preference': preference,
            })
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()['dietary_preference'], preference)
            member_id = response.json()['id']
            updated = self.client.patch(f'/api/family/members/{member_id}', json={
                'dietary_preference': 'vegan',
            })
            self.assertEqual(updated.status_code, 200, updated.text)
            self.assertTrue(updated.json()['vegetarian'])
        members = self.client.get('/api/family/members').json()['members']
        self.assertEqual(len(members), 4)
        self.assertTrue(all(m['dietary_preference'] == 'vegan' for m in members))
        with self.db.connection() as c:
            self.assertEqual(c.execute('SELECT household_size FROM settings WHERE id=1').fetchone()[0], 4)

    def test_reject_unknown_or_conflicting_preferences(self):
        self.assertEqual(self.client.post('/api/family/members', json={
            'name': 'Test', 'dietary_preference': 'pescatarian',
        }).status_code, 422)
        response = self.client.post('/api/family/members', json={
            'name': 'Test', 'dietary_preference': 'eggitarian',
        })
        self.assertEqual(response.status_code, 201)
        pid = response.json()['id']
        self.assertEqual(self.client.patch(f'/api/family/members/{pid}', json={
            'dietary_preference': 'invalid',
        }).status_code, 422)
        self.assertEqual(self.client.patch(f'/api/family/members/{pid}', json={
            'dietary_preference': 'vegan', 'vegetarian': False,
        }).status_code, 422)
        self.assertEqual(self.client.get('/api/family/members').json()['members'][0]['dietary_preference'], 'eggitarian')

    def test_legacy_boolean_compatibility(self):
        person = self.client.post('/api/family/members', json={'name': 'Old', 'vegetarian': True}).json()
        self.assertEqual(person['dietary_preference'], 'vegetarian')
        self.assertTrue(person['vegetarian'])
        updated = self.client.patch(f"/api/family/members/{person['id']}", json={'vegetarian': False})
        self.assertEqual(updated.json()['dietary_preference'], 'non-vegetarian')
        self.assertFalse(updated.json()['vegetarian'])

    def test_schema_upgrades_existing_rows_idempotently(self):
        with self.db.connection() as c:
            c.execute("INSERT INTO family_members(name,vegetarian) VALUES('Legacy Veg',1)")
            c.execute("INSERT INTO family_members(name,vegetarian) VALUES('Legacy NonVeg',0)")
            # Simulate an older instance by creating a separate pre-upgrade DB.
        old_path = Path(self.tmp.name) / 'old.sqlite3'
        with patch.object(self.db, 'DB_PATH', old_path):
            with self.db.connection() as c:
                c.execute('CREATE TABLE settings (id INTEGER PRIMARY KEY, household_name TEXT, household_size INTEGER)')
                c.execute("INSERT INTO settings VALUES (1, 'Existing', 4)")
                c.executescript('''
                    CREATE TABLE family_members (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
                        vegetarian INTEGER NOT NULL DEFAULT 0 CHECK(vegetarian IN(0,1)),
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO family_members(name, vegetarian) VALUES('Asha',1);
                    INSERT INTO family_members(name, vegetarian) VALUES('Ravi',0);
                ''')
            init_family_schema()
            init_family_schema()
            with self.db.connection() as c:
                rows = c.execute('SELECT name, dietary_preference FROM family_members ORDER BY id').fetchall()
                self.assertEqual([(r['name'],r['dietary_preference']) for r in rows],
                                 [('Asha','vegetarian'),('Ravi','non-vegetarian')])
                self.assertEqual(c.execute('SELECT household_size FROM settings WHERE id=1').fetchone()[0], 4)

if __name__ == '__main__':
    unittest.main()
