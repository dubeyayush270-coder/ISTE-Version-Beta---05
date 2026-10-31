"""Real FastAPI family router/startup smoke test on a disposable SQLite DB.

Runs in a subprocess to avoid shared-module/DB-state interference from other
KitchenSync tests that re-import app/db. Never accesses the user's live pantry.
"""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FamilyAPIIntegrationTests(unittest.TestCase):
    def test_family_router_startup_and_legacy_planner_unchanged(self):
        script = textwrap.dedent("""\
            from datetime import date, timedelta
            from fastapi.testclient import TestClient
            from app import app
            from db import connection

            with TestClient(app) as client:
                original = client.get('/api/settings')
                assert original.status_code == 200, original.text
                size = original.json()['household_size']

                health = client.get('/api/health')
                assert health.status_code == 200, health.text
                roster = client.get('/api/family/members')
                assert roster.status_code == 200, roster.text
                assert roster.json()['members'] == [], roster.text
                assert roster.json()['attendance_enabled'] is False

                member = client.post('/api/family/members', json={'name': 'Asha'})
                assert member.status_code == 201, member.text
                person_id = member.json()['id']

                day = (date.today() + timedelta(days=3)).isoformat()
                slot = f'/api/family/attendance/{day}/lunch'
                attendance = client.get(slot)
                assert attendance.status_code == 200, attendance.text
                assert attendance.json()['effective_eaters'] == size

                changed = client.put(slot, json={'member_ids': []})
                assert changed.status_code == 200, changed.text
                assert changed.json()['effective_eaters'] == size  # opt-in disabled
                assert changed.json()['has_override'] is True

                enabled = client.put('/api/family/config', json={'attendance_enabled': True})
                assert enabled.status_code == 200, enabled.text
                assert client.get(slot).json()['effective_eaters'] == 0
                assert client.delete(slot).json()['effective_eaters'] == 1

                assert client.get('/api/settings').json()['household_size'] == size
                # Until Phase 3, planned meals and shortages remain legacy-based.
                planner = client.get('/api/plan', params={'start': day, 'days': 1})
                shortages = client.get('/api/stock-check', params={'start': day, 'days': 1})
                assert planner.status_code == 200, planner.text
                assert shortages.status_code == 200, shortages.text
                with connection() as db:
                    assert db.execute('SELECT COUNT(*) FROM family_members').fetchone()[0] == 1

            # Startup migrations can run repeatedly without losing family data.
            from db import init_db
            from family_management import init_family_schema
            init_db()
            init_family_schema()
            with connection() as db:
                assert db.execute('SELECT COUNT(*) FROM family_members').fetchone()[0] == 1
            print('family_api_integration_ok')
        """)
        with tempfile.TemporaryDirectory() as temp:
            env = os.environ.copy()
            env['KITCHENSYNC_DB'] = str(Path(temp) / 'family-integration.sqlite3')
            backend = str(ROOT / 'backend')
            env['PYTHONPATH'] = backend + os.pathsep + env.get('PYTHONPATH', '')
            result = subprocess.run(
                [sys.executable, '-c', script],
                cwd=ROOT, env=env, capture_output=True,
                text=True, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)
            self.assertIn('family_api_integration_ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
