"""Family roster and date-specific meal attendance.

This module is intentionally additive.  Integrate router + migration into
app.py/startup only after coordinating shared-file edits with teammates.
Existing settings.household_size and meal_plan.eaters are NEVER modified here.
"""

import sqlite3
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field



def family_connection():
    """Resolve the active DB connection (including isolated test databases)."""
    from db import connection
    return connection()


router = APIRouter(prefix="/api/family", tags=["family"])
MEAL_TYPES = {"breakfast", "lunch", "dinner"}
MAX_MEMBERS = 30
DietaryPreference = Literal["vegetarian", "non-vegetarian", "eggitarian", "vegan"]


def is_legacy_vegetarian(preference: str) -> bool:
    # Keep the previous boolean response for older clients; eggitarian includes eggs.
    return preference in ("vegetarian", "vegan")


def resolve_preference(preference: str | None, vegetarian: bool | None) -> str:
    """Accept legacy vegetarian requests without losing four-choice preferences."""
    resolved = preference or ("vegetarian" if vegetarian else "non-vegetarian")
    if vegetarian is not None and is_legacy_vegetarian(resolved) != vegetarian:
        raise HTTPException(422, "Vegetarian and dietary preference values disagree.")
    return resolved


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    dietary_preference: DietaryPreference | None = None
    vegetarian: bool | None = None  # Legacy clients


class MemberChange(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    enabled: bool | None = None
    dietary_preference: DietaryPreference | None = None
    vegetarian: bool | None = None  # Legacy clients


class FamilyConfigChange(BaseModel):
    attendance_enabled: bool


class AttendanceChange(BaseModel):
    member_ids: list[int] = Field(default_factory=list, max_length=MAX_MEMBERS)


def init_family_schema():
    """Repeatable, non-destructive migration; preserves legacy settings."""
    with family_connection() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS family_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1
                    CHECK(enabled IN (0, 1)),
                vegetarian INTEGER NOT NULL DEFAULT 0
                    CHECK(vegetarian IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS family_config (
                id INTEGER PRIMARY KEY CHECK(id=1),
                attendance_enabled INTEGER NOT NULL DEFAULT 0
                    CHECK(attendance_enabled IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS family_attendance_days (
                meal_date TEXT NOT NULL,
                meal_type TEXT NOT NULL CHECK(meal_type IN
                    ('breakfast', 'lunch', 'dinner')),
                PRIMARY KEY(meal_date, meal_type)
            );

            CREATE TABLE IF NOT EXISTS family_attendees (
                meal_date TEXT NOT NULL,
                meal_type TEXT NOT NULL,
                member_id INTEGER NOT NULL,
                PRIMARY KEY(meal_date, meal_type, member_id),
                FOREIGN KEY(meal_date, meal_type)
                    REFERENCES family_attendance_days(meal_date, meal_type)
                    ON DELETE CASCADE,
                FOREIGN KEY(member_id)
                    REFERENCES family_members(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_family_attendees_member
                ON family_attendees(member_id);
        """)
        # Existing installations have only the previous vegetarian flag.
        # Preserve every existing row and map the previous true value to vegetarian.
        columns = {row["name"] for row in c.execute("PRAGMA table_info(family_members)")}
        if "dietary_preference" not in columns:
            c.execute("""
                ALTER TABLE family_members ADD COLUMN dietary_preference TEXT
                NOT NULL DEFAULT 'non-vegetarian'
                CHECK(dietary_preference IN
                    ('vegetarian', 'non-vegetarian', 'eggitarian', 'vegan'))
            """)
            c.execute("""
                UPDATE family_members SET dietary_preference='vegetarian'
                WHERE vegetarian=1
            """)
        c.execute("""
            INSERT OR IGNORE INTO family_config(id, attendance_enabled)
            VALUES (1, 0)
        """)


def member_json(row):
    item = dict(row)
    item["enabled"] = bool(item["enabled"])
    item["vegetarian"] = bool(item["vegetarian"])
    return item


def cleaned_name(name):
    value = name.strip()
    if not value:
        raise HTTPException(422, "Member name cannot be blank.")
    return value


def meal_slot(meal_type):
    if meal_type not in MEAL_TYPES:
        raise HTTPException(422, "Meal must be breakfast, lunch or dinner.")
    return meal_type


def get_member(c, member_id):
    row = c.execute("SELECT * FROM family_members WHERE id=?", (member_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Family member not found.")
    return member_json(row)


def family_state(c):
    config = c.execute(
        "SELECT attendance_enabled FROM family_config WHERE id=1"
    ).fetchone()
    legacy = c.execute(
        "SELECT household_size FROM settings WHERE id=1"
    ).fetchone()
    return {
        "attendance_enabled": bool(config["attendance_enabled"]) if config else False,
        "legacy_household_size": int(legacy["household_size"]) if legacy else None,
    }


@router.get("/members")
def list_family_members():
    with family_connection() as c:
        members = [member_json(row) for row in c.execute(
            "SELECT * FROM family_members ORDER BY id"
        )]
        return {"members": members, **family_state(c)}


@router.post("/members", status_code=201)
def add_family_member(data: MemberCreate):
    name = cleaned_name(data.name)
    preference = resolve_preference(data.dietary_preference, data.vegetarian)
    with family_connection() as c:
        count = c.execute("SELECT COUNT(*) FROM family_members").fetchone()[0]
        if count >= MAX_MEMBERS:
            raise HTTPException(409, "A household supports up to 30 members.")
        try:
            cursor = c.execute(
                "INSERT INTO family_members(name,vegetarian,dietary_preference) VALUES(?,?,?)",
                (name, int(is_legacy_vegetarian(preference)), preference),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "A member with this name already exists.") from None
        return get_member(c, cursor.lastrowid)


@router.patch("/members/{member_id}")
def edit_family_member(member_id: int, data: MemberChange):
    changes = data.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "Supply at least one field to change.")
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Member fields cannot be null.")
    if "name" in changes:
        changes["name"] = cleaned_name(changes["name"])
    if "dietary_preference" in changes or "vegetarian" in changes:
        preference = resolve_preference(
            changes.get("dietary_preference"), changes.get("vegetarian")
        )
        changes["dietary_preference"] = preference
        changes["vegetarian"] = int(is_legacy_vegetarian(preference))
    if "enabled" in changes:
        changes["enabled"] = int(changes["enabled"])
    with family_connection() as c:
        get_member(c, member_id)
        assignments = ", ".join(f"{column}=?" for column in changes)
        values = [*changes.values(), member_id]
        try:
            c.execute(f"UPDATE family_members SET {assignments} WHERE id=?", values)
        except sqlite3.IntegrityError:
            raise HTTPException(409, "A member with this name already exists.") from None
        return get_member(c, member_id)


@router.delete("/members/{member_id}")
def remove_family_member(member_id: int, confirmed: bool = Query(False)):
    if not confirmed:
        raise HTTPException(400, "Confirm removal with confirmed=true.")
    with family_connection() as c:
        get_member(c, member_id)
        c.execute("DELETE FROM family_members WHERE id=?", (member_id,))
    return {"ok": True}


@router.get("/config")
def get_family_config():
    with family_connection() as c:
        return family_state(c)


@router.put("/config")
def update_family_config(data: FamilyConfigChange):
    """Opt-in is explicit; never overwrites the legacy household size."""
    with family_connection() as c:
        if data.attendance_enabled:
            exists = c.execute("SELECT 1 FROM family_members LIMIT 1").fetchone()
            if not exists:
                raise HTTPException(409, "Add a family member before enabling attendance.")
        c.execute(
            "UPDATE family_config SET attendance_enabled=? WHERE id=1",
            (int(data.attendance_enabled),),
        )
        return family_state(c)


def attendance_for_slot(c, day, slot):
    day_str = day.isoformat()
    override = c.execute(
        "SELECT 1 FROM family_attendance_days WHERE meal_date=? AND meal_type=?",
        (day_str, slot),
    ).fetchone() is not None

    if override:
        selected = [row[0] for row in c.execute("""
            SELECT m.id FROM family_members m
            JOIN family_attendees a ON a.member_id=m.id
            WHERE a.meal_date=? AND a.meal_type=? AND m.enabled=1
            ORDER BY m.id
        """, (day_str, slot))]
    else:
        selected = [row[0] for row in c.execute(
            "SELECT id FROM family_members WHERE enabled=1 ORDER BY id"
        )]

    config = family_state(c)
    enabled = config["attendance_enabled"]
    return {
        "meal_date": day_str,
        "meal_type": slot,
        "mode": "legacy" if not enabled else ("override" if override else "default"),
        "has_override": override,
        "selected_member_ids": selected,
        "roster_eaters": len(selected),
        "effective_eaters": len(selected) if enabled else config["legacy_household_size"],
        **config,
    }


def eaters_for_planned_meal(c, meal_date, meal_type, saved_eaters, completed_at=None):
    """Return live attendance for upcoming meals, or their preserved saved count.

    Never updates meal_plan or household_size. Completed meals retain historical
    servings even if attendance is subsequently edited or a member is removed.
    """
    if completed_at or not family_state(c)["attendance_enabled"]:
        return int(saved_eaters)
    day = meal_date if isinstance(meal_date, date) else date.fromisoformat(meal_date)
    return attendance_for_slot(c, day, meal_type)["roster_eaters"]


@router.get("/attendance/{meal_date}/{meal_type}")
def get_meal_attendance(meal_date: date, meal_type: str):
    slot = meal_slot(meal_type)
    with family_connection() as c:
        return attendance_for_slot(c, meal_date, slot)


@router.put("/attendance/{meal_date}/{meal_type}")
def set_meal_attendance(meal_date: date, meal_type: str, data: AttendanceChange):
    """An explicit empty list means zero attendees (distinct from default)."""
    slot = meal_slot(meal_type)
    ids = data.member_ids
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Duplicate member IDs are not allowed.")
    with family_connection() as c:
        if ids:
            placeholders = ",".join("?" for _ in ids)
            rows = c.execute(
                f"SELECT id FROM family_members WHERE enabled=1 AND id IN ({placeholders})",
                ids,
            ).fetchall()
            if len(rows) != len(ids):
                raise HTTPException(422, "Attendance includes an unknown or disabled member.")
        c.execute("""
            INSERT OR IGNORE INTO family_attendance_days(meal_date,meal_type)
            VALUES(?,?)
        """, (meal_date.isoformat(), slot))
        c.execute("""
            DELETE FROM family_attendees WHERE meal_date=? AND meal_type=?
        """, (meal_date.isoformat(), slot))
        c.executemany("""
            INSERT INTO family_attendees(meal_date,meal_type,member_id)
            VALUES(?,?,?)
        """, [(meal_date.isoformat(), slot, member_id) for member_id in ids])
        return attendance_for_slot(c, meal_date, slot)


@router.delete("/attendance/{meal_date}/{meal_type}")
def reset_meal_attendance(meal_date: date, meal_type: str):
    slot = meal_slot(meal_type)
    with family_connection() as c:
        c.execute("""
            DELETE FROM family_attendance_days WHERE meal_date=? AND meal_type=?
        """, (meal_date.isoformat(), slot))
        return attendance_for_slot(c, meal_date, slot)
