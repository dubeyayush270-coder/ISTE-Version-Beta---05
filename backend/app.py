
"""KitchenSync: household plans, recipes, batch inventory and cooking."""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core import (
    audit_meals,
    inventory_map,
    scale_ingredients,
    stock_available,
)
from db import connection, init_db
from AI.api_router import router as ai_router
from family_management import (
    eaters_for_planned_meal,
    init_family_schema,
    router as family_router,
)



APP_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="KitchenSync API", version="0.3.0")

# Register AI recipe recommendation endpoints
app.include_router(ai_router)
app.include_router(family_router)



@app.on_event("startup")
def startup():
    init_db()
    init_family_schema()


# ==========================================
# DATABASE HELPERS
# ==========================================

def row_dict(row):
    return dict(row)


def batch_is_usable(ingredient, batch, today=None):
    """Check one purchase against expiry and leftover rules."""
    if float(batch["quantity"]) <= 0:
        return False

    candidate = dict(ingredient)
    candidate["expiry_date"] = batch["expiry_date"]

    # Preserve ingredient-level leftover safety information.
    if batch.get("storage") is not None:
        candidate["storage"] = batch["storage"]

    return stock_available(candidate, today=today)


def stock_list(c):
    """Inventory with physical and usable batch quantities."""
    items = [
        dict(row)
        for row in c.execute(
            "SELECT * FROM stock ORDER BY name"
        )
    ]

    for item in items:
        batches = [
            dict(row)
            for row in c.execute(
                "SELECT * FROM stock_batches WHERE stock_id = ?",
                (item["id"],),
            )
        ]

        if batches:
            physical = sum(
                float(batch["quantity"]) for batch in batches
            )
            usable = sum(
                float(batch["quantity"])
                for batch in batches
                if batch_is_usable(item, batch)
            )
        else:
            # Compatibility for legacy records not yet migrated.
            physical = float(item["quantity"])
            usable = (
                physical if stock_available(item) else 0.0
            )

        item["quantity"] = round(physical, 2)
        item["usable_quantity"] = round(usable, 2)
        item["usable"] = usable > 0

    return items



def planning_stock(items, c=None):
    """Create planning copies with optional purchase-batch details."""
    by_stock_id = {}

    if c is not None:
        for row in c.execute(
            "SELECT * FROM stock_batches WHERE quantity > 0"
        ):
            batch = dict(row)
            by_stock_id.setdefault(
                batch["stock_id"], []
            ).append(batch)

    result = []

    for item in items:
        entry = dict(item)
        entry["quantity"] = item["usable_quantity"]
        entry["expiry_date"] = None

        if by_stock_id.get(item["id"]):
            entry["batches"] = by_stock_id[item["id"]]

        result.append(entry)

    return result



def sync_stock(c, item_id):
    """Synchronize a stock summary from its batches."""
    c.execute(
        """
        UPDATE stock
        SET quantity = (
                SELECT COALESCE(SUM(quantity), 0)
                FROM stock_batches
                WHERE stock_id = ?
            ),
            expiry_date = (
                SELECT MIN(expiry_date)
                FROM stock_batches
                WHERE stock_id = ?
                  AND quantity > 0
            )
        WHERE id = ?
        """,
        (item_id, item_id, item_id),
    )


def seed_missing_batches(c):
    """Support legacy stock records without creating duplicates."""
    c.execute(
        """
        INSERT INTO stock_batches(
            stock_id, quantity, expiry_date,
            date_type, date_source, storage
        )
        SELECT
            s.id, s.quantity, s.expiry_date,
            'unknown', 'legacy_migration', s.storage
        FROM stock AS s
        WHERE NOT EXISTS (
            SELECT 1
            FROM stock_batches AS b
            WHERE b.stock_id = s.id
        )
        """
    )


def recipe_list(c):
    output = []

    for row in c.execute(
        "SELECT * FROM recipes ORDER BY category, name"
    ):
        item = dict(row)

        for key in ("tags", "ingredients", "steps"):
            item[key] = json.loads(item[key])

        output.append(item)

    return output


def plans(c, start, days=7):
    end = start + timedelta(days=days - 1)

    meals = [
        dict(row)
        for row in c.execute(
            """
            SELECT m.*, r.name AS recipe_name,
                   r.calories_per_serving,
                   r.minutes, r.category
            FROM meal_plan m
            JOIN recipes r ON m.recipe_id = r.id
            WHERE m.meal_date BETWEEN ? AND ?
            ORDER BY meal_date,
                CASE meal_type
                    WHEN 'breakfast' THEN 1
                    WHEN 'lunch' THEN 2
                    ELSE 3
                END
            """,
            (start.isoformat(), end.isoformat()),
        )
    ]

    for meal in meals:
        saved = int(meal["eaters"])
        meal["saved_eaters"] = saved
        meal["eaters"] = eaters_for_planned_meal(
            c, meal["meal_date"], meal["meal_type"], saved,
            meal.get("completed_at"),
        )
    return meals


# ==========================================
# INPUT MODELS
# ==========================================

class HouseholdUpdate(BaseModel):
    household_name: str = Field(min_length=1, max_length=80)
    household_size: int = Field(ge=1, le=30)



class StockInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: float = Field(ge=0, le=1_000_000)
    unit: str
    expiry_date: date | None = None
    is_leftover: bool = False
    prepared_at: datetime | None = None
    storage: str | None = None

    # Scanner metadata for the first purchase batch.
    date_type: str = "unknown"
    date_source: str = "manual"
    barcode: str | None = None
    purchase_date: date | None = None



class BatchInput(BaseModel):
    quantity: float = Field(gt=0, le=1_000_000)
    expiry_date: date | None = None
    date_type: str = "unknown"
    date_source: str | None = "manual"
    barcode: str | None = None
    purchase_date: date | None = None
    storage: str | None = None

class StockReconciliationInput(BaseModel):
    actual_quantity: float = Field(ge=0, le=1000000)
    reason: str = Field(min_length=3, max_length=250)
    confirmed: bool = False


class MealInput(BaseModel):
    recipe_id: int
    eaters: int = Field(ge=1, le=30)


DATE_TYPES = {
    "expiry", "use_by", "best_before",
    "estimated", "unknown",
}


def validate_batch(data):
    if data.date_type not in DATE_TYPES:
        raise HTTPException(422, "Invalid date type")

    return (
        data.quantity,
        data.expiry_date.isoformat()
        if data.expiry_date else None,
        data.date_type,
        data.date_source,
        data.barcode,
        data.purchase_date.isoformat()
        if data.purchase_date else None,
        data.storage,
    )


def validate_stock(data):
    if not data.name.strip():
        raise HTTPException(
            status_code=422,
            detail="Ingredient name cannot be empty.",
        )
    if data.unit not in ("g", "ml", "pcs"):
        raise HTTPException(
            422,
            "Unit must be g, ml, or pcs. "
            "Convert kg to g and L to ml.",
        )

    if data.is_leftover and (
        data.prepared_at is None
        or data.storage not in (
            "refrigerated", "room_temperature", "frozen"
        )
    ):
        raise HTTPException(
            422,
            "Leftovers require a prepared time and storage method.",
        )

    return (
        data.name.strip(),
        data.quantity,
        data.unit,
        data.expiry_date.isoformat()
        if data.expiry_date else None,
        int(data.is_leftover),
        data.prepared_at.isoformat(timespec="seconds")
        if data.prepared_at else None,
        data.storage,
    )


# ==========================================
# HEALTH AND SETTINGS
# ==========================================

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.3.0"}


@app.get("/api/settings")
def settings():
    with connection() as c:
        return row_dict(
            c.execute(
                "SELECT * FROM settings WHERE id=1"
            ).fetchone()
        )


@app.put("/api/settings")
def save_settings(data: HouseholdUpdate):
    with connection() as c:
        c.execute(
            """
            UPDATE settings
            SET household_name=?, household_size=?
            WHERE id=1
            """,
            (data.household_name.strip(), data.household_size),
        )

    return settings()


# ==========================================
# INVENTORY
# ==========================================

@app.get("/api/inventory")
def inventory():
    with connection() as c:
        return stock_list(c)


@app.get("/api/inventory/{item_id}/batches")
def get_inventory_batches(item_id: int):
    with connection() as c:
        ingredient = c.execute(
            "SELECT id, name, unit FROM stock WHERE id=?",
            (item_id,),
        ).fetchone()

        if ingredient is None:
            raise HTTPException(404, "Ingredient not found")

        batches = [
            dict(row)
            for row in c.execute(
                """
                SELECT *
                FROM stock_batches
                WHERE stock_id=?
                ORDER BY
                    CASE
                        WHEN expiry_date IS NULL THEN 1
                        ELSE 0
                    END,
                    expiry_date,
                    id
                """,
                (item_id,),
            )
        ]

        return {
            "ingredient_id": ingredient["id"],
            "ingredient_name": ingredient["name"],
            "unit": ingredient["unit"],
            "total_quantity": round(
                sum(b["quantity"] for b in batches), 2
            ),
            "batches": batches,
        }


@app.post("/api/inventory/{item_id}/batches", status_code=201)
def add_inventory_batch(item_id: int, data: BatchInput):
    values = validate_batch(data)

    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        ingredient = c.execute(
            "SELECT id FROM stock WHERE id=?",
            (item_id,),
        ).fetchone()

        if ingredient is None:
            raise HTTPException(404, "Ingredient not found")

        cursor = c.execute(
            """
            INSERT INTO stock_batches(
                stock_id, quantity, expiry_date,
                date_type, date_source, barcode,
                purchase_date, storage
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (item_id, *values),
        )

        sync_stock(c, item_id)

        total = c.execute(
            "SELECT quantity FROM stock WHERE id=?",
            (item_id,),
        ).fetchone()["quantity"]

    return {
        "ok": True,
        "batch_id": cursor.lastrowid,
        "ingredient_id": item_id,
        "total_quantity": total,
        "message": "Purchase batch added successfully",
    }


@app.put("/api/inventory/{item_id}/batches/{batch_id}")
def edit_inventory_batch(
    item_id: int,
    batch_id: int,
    data: BatchInput,
):
    values = validate_batch(data)

    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        cursor = c.execute(
            """
            UPDATE stock_batches
            SET quantity=?, expiry_date=?, date_type=?,
                date_source=?, barcode=?, purchase_date=?,
                storage=?
            WHERE id=? AND stock_id=?
            """,
            (*values, batch_id, item_id),
        )

        if not cursor.rowcount:
            raise HTTPException(404, "Purchase batch not found")

        sync_stock(c, item_id)

    return {"ok": True}


@app.delete("/api/inventory/{item_id}/batches/{batch_id}")
def delete_inventory_batch(item_id: int, batch_id: int):
    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        cursor = c.execute(
            """
            DELETE FROM stock_batches
            WHERE id=? AND stock_id=?
            """,
            (batch_id, item_id),
        )

        if not cursor.rowcount:
            raise HTTPException(404, "Purchase batch not found")

        sync_stock(c, item_id)

    return {"ok": True}



@app.post("/api/inventory", status_code=201)
def add_inventory(data: StockInput):
    values = validate_stock(data)

    # Validate scanned date type before modifying the database.
    if data.date_type not in DATE_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Invalid date type"
        )

    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        if c.execute(
            "SELECT 1 FROM stock WHERE name=?",
            (values[0],),
        ).fetchone():
            raise HTTPException(
                409,
                "An item with this name already exists. "
                "Add a purchase batch instead.",
            )

        cursor = c.execute(
            """
            INSERT INTO stock(
                name, quantity, unit, expiry_date,
                is_leftover, prepared_at, storage
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )

        item_id = cursor.lastrowid

        # Create the first purchase batch and preserve
        # all metadata supplied by the scanner.
        c.execute(
            """
            INSERT INTO stock_batches(
                stock_id,
                quantity,
                expiry_date,
                date_type,
                date_source,
                barcode,
                purchase_date,
                storage
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                data.quantity,
                values[3],
                data.date_type,
                data.date_source,
                data.barcode,
                data.purchase_date.isoformat()
                if data.purchase_date else None,
                data.storage,
            ),
        )

    return {"ok": True}



@app.post("/api/inventory/{item_id}/reconcile")
def reconcile_inventory(item_id: int, data: StockReconciliationInput):
    """Reconcile physically counted inventory against purchase batches."""

    if not data.confirmed:
        raise HTTPException(
            status_code=422,
            detail="Confirm the physical stock count before applying."
        )

    reason = data.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Please provide an adjustment reason.")

    actual = round(data.actual_quantity, 2)
    if abs(data.actual_quantity - actual) > 1e-9:
        raise HTTPException(
            422, "Quantity supports at most two decimal places."
        )

    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        ingredient_row = c.execute(
            "SELECT * FROM stock WHERE id=?",
            (item_id,)
        ).fetchone()

        if ingredient_row is None:
            raise HTTPException(404, "Ingredient not found")

        ingredient = dict(ingredient_row)

        if ingredient["unit"] == "pcs" and not float(actual).is_integer():
            raise HTTPException(
                422, "Piece quantities must be whole numbers."
            )

        batches = [
            dict(row)
            for row in c.execute(
                """
                SELECT *
                FROM stock_batches
                WHERE stock_id=?
                ORDER BY
                    CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
                    expiry_date,
                    id
                """,
                (item_id,)
            )
        ]

        # Support older stock records without purchase batches.
        if not batches:
            c.execute(
                """
                INSERT INTO stock_batches(
                    stock_id, quantity, expiry_date,
                    date_type, date_source, storage
                )
                VALUES (?, ?, ?, 'unknown', 'legacy_migration', ?)
                """,
                (
                    item_id,
                    ingredient["quantity"],
                    ingredient["expiry_date"],
                    ingredient["storage"]
                )
            )

            batches = [
                dict(row)
                for row in c.execute(
                    """
                    SELECT *
                    FROM stock_batches
                    WHERE stock_id=?
                    ORDER BY id
                    """,
                    (item_id,)
                )
            ]

        previous = round(
            sum(float(batch["quantity"]) for batch in batches),
            2
        )

        difference = round(actual - previous, 2)
        batch_changes = []

        if difference < 0:
            # Policy: allocate unexplained missing stock to the
            # earliest-expiring batches first.
            remaining = round(-difference, 2)

            for batch in batches:
                before = round(float(batch["quantity"]), 2)

                if before <= 0:
                    continue

                reduction = min(before, remaining)
                after = round(before - reduction, 2)

                c.execute(
                    """
                    UPDATE stock_batches
                    SET quantity=?
                    WHERE id=? AND stock_id=?
                    """,
                    (after, batch["id"], item_id)
                )

                batch_changes.append({
                    "batch_id": batch["id"],
                    "previous": before,
                    "actual": after,
                    "expiry_date": batch["expiry_date"]
                })

                remaining = round(remaining - reduction, 2)

                if remaining <= 0:
                    break

            if remaining > 0:
                raise HTTPException(
                    409, "Could not allocate the stock correction."
                )

        elif difference > 0:
            # An unexplained increase is not a verified purchase.
            # Create a separate adjustment batch with unknown expiry.
            cursor = c.execute(
                """
                INSERT INTO stock_batches(
                    stock_id, quantity, expiry_date,
                    date_type, date_source, storage
                )
                VALUES (
                    ?, ?, NULL,
                    'unknown', 'manual_stock_reconciliation', ?
                )
                """,
                (
                    item_id,
                    difference,
                    ingredient["storage"]
                )
            )

            batch_changes.append({
                "batch_id": cursor.lastrowid,
                "previous": 0,
                "actual": difference,
                "expiry_date": None,
                "type": "unverified_adjustment"
            })

        else:
            return {
                "ok": True,
                "changed": False,
                "ingredient_name": ingredient["name"],
                "quantity": previous,
                "message": "Physical count already matches recorded stock."
            }

        # Existing KitchenSync helper — keep summary in sync.
        sync_stock(c, item_id)

        updated = c.execute(
            "SELECT quantity FROM stock WHERE id=?",
            (item_id,)
        ).fetchone()

        final_quantity = round(float(updated["quantity"]), 2)

        if abs(final_quantity - actual) > 0.001:
            raise HTTPException(
                409, "Reconciled total did not match physical count."
            )

        cursor = c.execute(
            """
            INSERT INTO stock_reconciliations(
                stock_id, ingredient_name, unit,
                previous_quantity, actual_quantity,
                difference, reason, batch_changes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                ingredient["name"],
                ingredient["unit"],
                previous,
                actual,
                difference,
                reason,
                json.dumps(batch_changes)
            )
        )

        adjustment_id = cursor.lastrowid

    return {
        "ok": True,
        "changed": True,
        "adjustment_id": adjustment_id,
        "ingredient_name": ingredient["name"],
        "unit": ingredient["unit"],
        "previous_quantity": previous,
        "actual_quantity": final_quantity,
        "difference": difference,
        "batch_changes": batch_changes,
        "message": "Stock reconciliation saved successfully."
    }


@app.get("/api/inventory/{item_id}/reconciliations")
def get_stock_reconciliations(item_id: int):
    """Return the manual adjustment history for one ingredient."""

    with connection() as c:
        ingredient = c.execute(
            "SELECT id FROM stock WHERE id=?",
            (item_id,)
        ).fetchone()

        if ingredient is None:
            raise HTTPException(404, "Ingredient not found")

        records = [
            dict(row)
            for row in c.execute(
                """
                SELECT *
                FROM stock_reconciliations
                WHERE stock_id=?
                ORDER BY created_at DESC, id DESC
                """,
                (item_id,)
            )
        ]

        for record in records:
            record["batch_changes"] = json.loads(
                record["batch_changes"]
            )

    return {
        "ingredient_id": item_id,
        "adjustments": records
    }



@app.put("/api/inventory/{item_id}")
def edit_inventory(item_id: int, data: StockInput):
    values = validate_stock(data)

    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        existing = c.execute(
            "SELECT id, unit FROM stock WHERE id=?",
            (item_id,),
        ).fetchone()

        if existing is None:
            raise HTTPException(404, "Ingredient not found")

        if existing["unit"] != data.unit:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Changing an ingredient's unit is not supported. "
                    "Use the existing unit to preserve purchase batch quantities."
                ),
            )

        if c.execute(
            "SELECT 1 FROM stock WHERE name=? AND id<>?",
            (values[0], item_id),
        ).fetchone():
            raise HTTPException(
                409, "Ingredient name already exists"
            )

        batch_count = c.execute(
            """
            SELECT COUNT(*)
            FROM stock_batches
            WHERE stock_id=?
            """,
            (item_id,),
        ).fetchone()[0]

        if batch_count > 1:
            raise HTTPException(
                409,
                "This ingredient has multiple purchase batches. "
                "Edit its batches individually.",
            )

        c.execute(
            """
            UPDATE stock
            SET name=?, quantity=?, unit=?, expiry_date=?,
                is_leftover=?, prepared_at=?, storage=?
            WHERE id=?
            """,
            (*values, item_id),
        )

        if batch_count == 1:
            c.execute(
                """
                UPDATE stock_batches
                SET quantity=?, expiry_date=?, storage=?
                WHERE stock_id=?
                """,
                (
                    data.quantity,
                    values[3],
                    data.storage,
                    item_id,
                ),
            )
        else:
            c.execute(
                """
                INSERT INTO stock_batches(
                    stock_id, quantity, expiry_date,
                    date_type, date_source, storage
                )
                VALUES (?, ?, ?, 'unknown', 'manual', ?)
                """,
                (
                    item_id,
                    data.quantity,
                    values[3],
                    data.storage,
                ),
            )

        sync_stock(c, item_id)

    return {"ok": True}


@app.delete("/api/inventory/{item_id}")
def remove_inventory(item_id: int):
    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        cursor = c.execute(
            "DELETE FROM stock WHERE id=?",
            (item_id,),
        )

        if not cursor.rowcount:
            raise HTTPException(404, "Ingredient not found")

    return {"ok": True}


# ==========================================
# RECIPES AND SUGGESTIONS
# ==========================================

@app.get("/api/recipes")
def recipes():
    with connection() as c:
        return recipe_list(c)


@app.get("/api/suggestions")
def suggestions(craving: str = ""):
    """Offline fallback suggestions; AI integration comes later."""
    with connection() as c:
        stock = inventory_map(planning_stock(stock_list(c)))
        recipes_data = recipe_list(c)

    words = set(craving.lower().split())
    results = []

    for recipe in recipes_data:
        required = scale_ingredients(recipe, 2)

        covered = sum(
            1
            for need in required
            if (
                need["name"].casefold() in stock
                and stock[need["name"].casefold()]["unit"]
                == need["unit"]
                and stock[need["name"].casefold()]["quantity"]
                >= need["quantity"]
            )
        )

        match = sum(
            1
            for word in words
            if (
                word in recipe["name"].lower()
                or word in recipe["tags"]
            )
        )

        results.append({
            "recipe": recipe,
            "covered": covered,
            "total": len(required),
            "score": round(
                covered / max(1, len(required)), 2
            ) + match * 0.5,
        })

    results.sort(key=lambda r: r["score"], reverse=True)

    return {
        "mode": "offline-rule-based-demo",
        "results": results[:5],
    }


# ==========================================
# MEAL PLANNING
# ==========================================

@app.get("/api/plan")
def get_plan(
    start: date | None = None,
    days: int = Query(7, ge=1, le=31),
):
    with connection() as c:
        return plans(c, start or date.today(), days)


@app.put("/api/plan/{meal_date}/{meal_type}")
def set_meal(
    meal_date: date,
    meal_type: str,
    data: MealInput,
):
    if meal_type not in ("breakfast", "lunch", "dinner"):
        raise HTTPException(422, "Invalid meal type")

    with connection() as c:
        recipe = c.execute(
            "SELECT 1 FROM recipes WHERE id=?",
            (data.recipe_id,),
        ).fetchone()

        if not recipe:
            raise HTTPException(404, "Recipe not found")

        existing = c.execute(
            """
            SELECT completed_at
            FROM meal_plan
            WHERE meal_date=? AND meal_type=?
            """,
            (meal_date.isoformat(), meal_type),
        ).fetchone()

        if existing and existing["completed_at"]:
            raise HTTPException(
                409,
                "Completed meals cannot be changed; "
                "stock has already been deducted.",
            )

        c.execute(
            """
            INSERT INTO meal_plan(
                meal_date, meal_type, recipe_id, eaters
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(meal_date, meal_type)
            DO UPDATE SET
                recipe_id=excluded.recipe_id,
                eaters=excluded.eaters
            """,
            (
                meal_date.isoformat(),
                meal_type,
                data.recipe_id,
                data.eaters,
            ),
        )

    return {"ok": True}


@app.delete("/api/plan/{meal_date}/{meal_type}")
def delete_meal(meal_date: date, meal_type: str):
    with connection() as c:
        existing = c.execute(
            """
            SELECT completed_at
            FROM meal_plan
            WHERE meal_date=? AND meal_type=?
            """,
            (meal_date.isoformat(), meal_type),
        ).fetchone()

        if not existing:
            raise HTTPException(404, "Meal not found")

        if existing["completed_at"]:
            raise HTTPException(
                409, "Cannot delete a completed meal"
            )

        c.execute(
            """
            DELETE FROM meal_plan
            WHERE meal_date=? AND meal_type=?
            """,
            (meal_date.isoformat(), meal_type),
        )

    return {"ok": True}


@app.get("/api/stock-check")
def stock_check(
    start: date | None = None,
    days: int = Query(7, ge=1, le=31),
):
    start = start or date.today()

    with connection() as c:
        meals = plans(c, start, days)
        stock = planning_stock(stock_list(c), c)
        recipes_data = recipe_list(c)

    audit = audit_meals(
        [meal for meal in meals if meal["eaters"] > 0],
        {recipe["id"]: recipe for recipe in recipes_data},
        stock,
    )

    return {
        "start": start.isoformat(),
        "days": days,
        **audit,
    }


# ==========================================
# BATCH-AWARE MEAL COMPLETION
# ==========================================

@app.post("/api/plan/{meal_date}/{meal_type}/complete")
def complete_meal(meal_date: date, meal_type: str):
    if meal_date > date.today():
        raise HTTPException(
            status_code=409,
            detail="Cannot complete a future meal."
        )
    with connection() as c:
        c.execute("BEGIN IMMEDIATE")

        seed_missing_batches(c)

        row = c.execute(
            """
            SELECT
                m.*,
                r.name AS recipe_name,
                r.base_servings,
                r.ingredients
            FROM meal_plan m
            JOIN recipes r ON r.id=m.recipe_id
            WHERE m.meal_date=? AND m.meal_type=?
            """,
            (meal_date.isoformat(), meal_type),
        ).fetchone()

        if row is None:
            raise HTTPException(404, "Planned meal not found")

        if row["completed_at"]:
            raise HTTPException(
                409,
                "Already completed. Inventory was deducted previously.",
            )

        recipe = {
            "base_servings": row["base_servings"],
            "ingredients": json.loads(row["ingredients"]),
        }

        actual_eaters = eaters_for_planned_meal(
            c, row["meal_date"], row["meal_type"], row["eaters"],
        )
        if actual_eaters == 0:
            raise HTTPException(
                409,
                "No family members are attending this meal. "
                "Choose attendees before completing it.",
            )

        required = scale_ingredients(recipe, actual_eaters)
        stock = {
            item["name"].casefold(): item
            for item in stock_list(c)
        }

        # Aggregate duplicate ingredients before checking.
        needs = {}

        for ingredient in required:
            key = ingredient["name"].casefold()

            if key not in needs:
                needs[key] = {
                    "name": ingredient["name"],
                    "unit": ingredient["unit"],
                    "quantity": 0.0,
                }

            if needs[key]["unit"] != ingredient["unit"]:
                raise HTTPException(
                    409,
                    "Conflicting units for " + ingredient["name"],
                )

            needs[key]["quantity"] += ingredient["quantity"]

        missing = []

        for key, need in needs.items():
            item = stock.get(key)

            if (
                item is None
                or item["unit"] != need["unit"]
                or item["usable_quantity"] + 1e-8
                < need["quantity"]
            ):
                missing.append(
                    f"{need['name']}: need "
                    f"{round(need['quantity'], 2)} "
                    f"{need['unit']}"
                )

        if missing:
            raise HTTPException(
                409,
                {
                    "message": "Not enough usable ingredients.",
                    "missing": missing,
                },
            )

        # FEFO: First Expiring, First Out.
        for key, need in needs.items():
            item = stock[key]
            remaining = need["quantity"]

            batches = [
                dict(batch)
                for batch in c.execute(
                    """
                    SELECT *
                    FROM stock_batches
                    WHERE stock_id=? AND quantity>0
                    ORDER BY
                        CASE
                            WHEN expiry_date IS NULL THEN 1
                            ELSE 0
                        END,
                        expiry_date,
                        id
                    """,
                    (item["id"],),
                )
            ]

            for batch in batches:
                if remaining <= 1e-8:
                    break

                if not batch_is_usable(item, batch):
                    continue

                taken = min(
                    remaining,
                    float(batch["quantity"]),
                )

                c.execute(
                    """
                    UPDATE stock_batches
                    SET quantity=MAX(0, quantity-?)
                    WHERE id=?
                    """,
                    (taken, batch["id"]),
                )

                remaining -= taken

            if remaining > 1e-6:
                raise HTTPException(
                    409,
                    "Insufficient eligible batches for "
                    + need["name"],
                )

            sync_stock(c, item["id"])

        c.execute(
            """
            UPDATE meal_plan
            SET completed_at=?, eaters=?
            WHERE id=?
            """,
            (
                datetime.now().isoformat(timespec="seconds"),
                actual_eaters,
                row["id"],
            ),
        )

    return {
        "ok": True,
        "recipe": row["recipe_name"],
        "deducted": required,
    }


# ==========================================
# BATCH-AWARE DASHBOARD
# ==========================================

@app.get("/api/dashboard")
def dashboard():
    today = date.today()

    with connection() as c:
        stock = stock_list(c)
        recipes_data = recipe_list(c)
        week = plans(c, today, 7)
        planning = planning_stock(stock, c)

        today_plan = [
            meal
            for meal in week
            if meal["meal_date"] == today.isoformat()
        ]

        stock_by_id = {
            item["id"]: item for item in stock
        }

        batches = [
            dict(row)
            for row in c.execute(
                """
                SELECT *
                FROM stock_batches
                WHERE quantity>0
                """
            )
        ]

    audit = audit_meals(
        [meal for meal in week if meal["eaters"] > 0],
        {r["id"]: r for r in recipes_data},
        planning_stock(stock),
    )


    expired = []
    expiring = []

    for batch in batches:
        ingredient = stock_by_id.get(batch["stock_id"])

        if ingredient is None:
            continue

        date_type = batch["date_type"] or "unknown"
        recorded_date = batch["expiry_date"]

        days_remaining = None

        if recorded_date:
            recorded = date.fromisoformat(recorded_date)
            days_remaining = (recorded - today).days

        usable = batch_is_usable(ingredient, batch, today)

        details = {
            **ingredient,
            "batch_id": batch["id"],
            "quantity": batch["quantity"],
            "expiry_date": recorded_date,
            "date_type": date_type,
            "date_source": batch["date_source"],
            "days_until_date": days_remaining,
            "usable": usable,
        }

        # Batch is currently excluded by the existing
        # conservative stock-availability rules.
        if not usable:
            if days_remaining is not None and days_remaining < 0:
                messages = {
                    "use_by": (
                        "Use-by date has passed. "
                        "Do not consume this batch."
                    ),
                    "expiry": (
                        "Expiry date has passed. "
                        "Do not use this batch."
                    ),
                    "best_before": (
                        "Best-before date has passed. "
                        "Review product quality and storage. "
                        "This batch is conservatively excluded "
                        "from meal planning."
                    ),
                    "estimated": (
                        "Estimated freshness date has passed. "
                        "Review storage and condition. "
                        "This batch is conservatively excluded "
                        "from meal planning."
                    ),
                    "unknown": (
                        "Recorded date has passed. "
                        "Check the original product label. "
                        "This batch is excluded from meal planning."
                    ),
                }

                alert_message = messages.get(
                    date_type, messages["unknown"]
                )

                alert_code = "past_recorded_date"

            else:
                alert_code = "storage_or_safety_review"
                alert_message = (
                    "This batch is unavailable under current "
                    "storage or leftover safety rules. "
                    "Review before use."
                )

            expired.append({
                **details,
                "alert_code": alert_code,
                "alert_message": alert_message,
            })

            continue

        # The recorded date is approaching within 3 days.
        if days_remaining is not None and 0 <= days_remaining <= 3:
            messages = {
                "use_by": (
                    "Use-by date is approaching. "
                    "Follow the label and storage instructions."
                ),
                "expiry": (
                    "Expiry date is approaching. "
                    "Plan to use this batch before it passes."
                ),
                "best_before": (
                    "Best-before quality date is approaching. "
                    "Check product quality and storage."
                ),
                "estimated": (
                    "Estimated freshness window is ending. "
                    "Check condition and storage."
                ),
                "unknown": (
                    "Recorded date is approaching. "
                    "Verify the original date label."
                ),
            }


            expiring.append({
                **details,
                "alert_code": "approaching_recorded_date",
                "alert_message": messages.get(
                    date_type, messages["unknown"]
                ),
            })


    return {
        "household": settings(),
        "stock_items": len(stock),
        "planned_meals": len(week),
        "today_meals": today_plan,
        "missing_alerts": audit["warnings"][:8],
        "expired_or_unsafe": expired,
        "expiring_soon": expiring,
        "shopping_count": len(audit["shopping"]),
    }




# ==========================================
# REACT FRONTEND
# ==========================================

DIST_DIR = APP_DIR / "frontend" / "dist"

if DIST_DIR.is_dir():
    app.mount(
        "/assets",
        StaticFiles(
            directory=DIST_DIR / "assets"
        ),
        name="react-assets",
    )


@app.get("/")
def index():
    built_index = DIST_DIR / "index.html"

    if built_index.is_file():
        return FileResponse(built_index)

    return JSONResponse({
        "message": (
            "KitchenSync FastAPI running. "
            "Open http://127.0.0.1:5173 for the React UI."
        ),
        "api_docs": "/docs",
    })
