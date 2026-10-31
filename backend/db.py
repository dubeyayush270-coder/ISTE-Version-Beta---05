
"""SQLite initialization and demo seed. Easy to replace with PostgreSQL later."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

from catalog import RECIPES, STARTER_INVENTORY


DB_PATH = Path(
    os.getenv(
        "KITCHENSYNC_DB",
        str(Path(__file__).resolve().parent / "kitchensync.sqlite3")
    )
)


@contextmanager
def connection():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with connection() as c:

        # 1. DATABASE TABLES
        c.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK(id=1),
                household_name TEXT NOT NULL,
                household_size INTEGER NOT NULL
                    CHECK(household_size BETWEEN 1 AND 30)
            );

            CREATE TABLE IF NOT EXISTS stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                quantity REAL NOT NULL CHECK(quantity >= 0),
                unit TEXT NOT NULL
                    CHECK(unit IN ('g', 'ml', 'pcs')),
                expiry_date TEXT,
                is_leftover INTEGER NOT NULL DEFAULT 0,
                prepared_at TEXT,
                storage TEXT
            );

            -- Each stock item can have multiple purchases
            CREATE TABLE IF NOT EXISTS stock_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                stock_id INTEGER NOT NULL
                    REFERENCES stock(id) ON DELETE CASCADE,

                quantity REAL NOT NULL CHECK(quantity >= 0),

                expiry_date TEXT,

                date_type TEXT NOT NULL DEFAULT 'unknown'
                    CHECK(date_type IN (
                        'expiry',
                        'use_by',
                        'best_before',
                        'estimated',
                        'unknown'
                    )),

                date_source TEXT,
                barcode TEXT,
                purchase_date TEXT,
                storage TEXT,

                created_at TEXT NOT NULL
                    DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_batches_stock_expiry
                ON stock_batches(stock_id, expiry_date);

            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                tags TEXT NOT NULL,
                base_servings INTEGER NOT NULL,
                calories_per_serving REAL NOT NULL,
                minutes INTEGER NOT NULL,
                ingredients TEXT NOT NULL,
                steps TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meal_plan (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meal_date TEXT NOT NULL,
                meal_type TEXT NOT NULL
                    CHECK(meal_type IN (
                        'breakfast', 'lunch', 'dinner'
                    )),
                recipe_id INTEGER NOT NULL
                    REFERENCES recipes(id),
                eaters INTEGER NOT NULL
                    CHECK(eaters BETWEEN 1 AND 30),
                completed_at TEXT,
                UNIQUE(meal_date, meal_type)
            );

            CREATE INDEX IF NOT EXISTS idx_plan_date
                ON meal_plan(meal_date);
        """)

        # 2. DEMO SEEDING
        # Seed only when settings have not been initialized.
        settings_exist = c.execute(
            "SELECT 1 FROM settings"
        ).fetchone()

        if not settings_exist:

            c.execute(
                "INSERT INTO settings VALUES(1, ?, ?)",
                ("The Sharma Family (Demo)", 4)
            )

            for (
                name, quantity, unit, expiry,
                leftover, prepared, storage
            ) in STARTER_INVENTORY:

                c.execute("""
                    INSERT INTO stock(
                        name, quantity, unit, expiry_date,
                        is_leftover, prepared_at, storage
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                """, (
                    name, quantity, unit, expiry,
                    leftover, prepared, storage
                ))

            for r in RECIPES:

                c.execute("""
                    INSERT INTO recipes(
                        name, category, tags,
                        base_servings, calories_per_serving,
                        minutes, ingredients, steps
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    r["name"],
                    r["category"],
                    json.dumps(r["tags"]),
                    r["base_servings"],
                    r["calories_per_serving"],
                    r["minutes"],
                    json.dumps(r["ingredients"]),
                    json.dumps(r["steps"])
                ))

            ids = {
                r["name"]: r["id"]
                for r in c.execute(
                    "SELECT id, name FROM recipes"
                )
            }

            today = date.today()

            for d, slot, recipe in [
                (today, "breakfast", "Vegetable Poha"),
                (today, "lunch", "Dal Rice"),
                (today, "dinner", "Paneer Masala"),
                (
                    today + timedelta(days=1),
                    "lunch", "Vegetable Pulao"
                )
            ]:

                c.execute("""
                    INSERT INTO meal_plan(
                        meal_date, meal_type, recipe_id, eaters
                    )
                    VALUES(?, ?, ?, ?)
                """, (
                    d.isoformat(), slot, ids[recipe], 4
                ))

        # 3. MIGRATE OLD INVENTORY
        # Create one initial batch per existing ingredient.
        # Repeated initialization will not duplicate batches.

        c.execute("""
            INSERT INTO stock_batches(
                stock_id,
                quantity,
                expiry_date,
                date_type,
                date_source,
                storage
            )
            SELECT
                s.id,
                s.quantity,
                s.expiry_date,
                'unknown',
                'legacy_migration',
                s.storage
            FROM stock AS s
            WHERE NOT EXISTS (
                SELECT 1
                FROM stock_batches AS b
                WHERE b.stock_id = s.id
            )
        """)
