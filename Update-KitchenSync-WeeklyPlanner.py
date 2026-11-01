#!/usr/bin/env python3
"""Preserve-and-update the three existing KitchenSync weekly-planner source files.

This script runs ON THE USER'S MACHINE so it can read their actual uncommitted
files. It validates every expected anchor before changing any source file and
creates timestamped backups. It never stages, commits, or pushes Git changes.
"""
from __future__ import annotations

import ast
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

REQUIRED = (
    Path('frontend/src/components/WeeklyPlanGenerator.jsx'),
    Path('backend/weekly_planner_api.py'),
    Path('backend/weekly_planner.py'),
)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    n = text.count(old)
    if n != 1:
        raise ValueError(f'{label}: expected exactly 1 matching section; found {n}. No files were changed.')
    return text.replace(old, new, 1)


def sub_once(text: str, pat: str, repl: str, label: str, flags: int = 0) -> str:
    result, n = re.subn(pat, lambda m: repl, text, count=1, flags=flags)
    if n != 1:
        raise ValueError(f'{label}: expected 1 matching section; found {n}. No files were changed.')
    return result


def update_js(src: str) -> str:
    src = replace_once(src,
        '<option value="any">Any recipe</option><option value="vegetarian">Vegetarian (no eggs)</option>',
        '''<option value="any">Any recipe</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="vegan">Vegan</option>
            <option value="non-vegetarian">Non-vegetarian</option>
            <option value="eggitarian">Eggetarian</option>''',
        'dietary selector')
    # Keep the existing modal, preview workflow, confirm/save and error handling.
    src = replace_once(src,
        '{preview?.household_size || householdSize} people by default',
        "{preview?.attendance_enabled ? 'Family attendance determines servings' : `${preview?.household_size || householdSize} people by default`}",
        'attendance-aware preview heading')
    return src


DIET_CODE = '''# Dietary values are kept compatible with Family Management's stored values.
# "eggitarian" is the saved API value; the UI displays "Eggetarian".
_DIET_RANK = {"any": 0, "non-vegetarian": 0, "eggitarian": 1,
              "vegetarian": 2, "vegan": 3}
_ANIMAL_PRODUCTS = (
    "milk", "buttermilk", "paneer", "cheese", "butter", "ghee",
    "curd", "yogurt", "yoghurt", "cream", "whey", "casein",
    "honey", "mayonnaise", "albumen", "lard", "tallow",
)


def diet_compatible(ingredients, food_type):
    """Conservative ingredient-name filter (not an allergy guarantee)."""
    food_type = food_type or "any"
    if food_type in ("any", "non-vegetarian"):
        return True
    if food_type not in _DIET_RANK:
        return False
    non_veg = set(find_non_vegetarian_ingredients(ingredients))
    if food_type == "eggitarian":
        # Eggs are allowed, but fish/meat/gelatin are not.
        return not (non_veg - {"egg"})
    if non_veg:
        return False
    if food_type == "vegetarian":
        return not any(ingredient_mentioned(" ".join(map(str, ingredients)).casefold(), x)
                       for x in ("mayonnaise", "albumen", "lard", "tallow"))
    if food_type == "vegan":
        for item in ingredients:
            ingredient = str(item).casefold().strip()
            # Always reject honey and other animal additives even if a
            # plant-based substitute is mentioned elsewhere in the text.
            if any(ingredient_mentioned(ingredient, x)
                   for x in ("honey", "gelatin", "lard", "tallow", "casein", "whey")):
                return False
            if re.match(r"^(?:almond|soy|soya|oat|coconut|rice|cashew|vegan|plant[- ]based)\\s+"
                        r"(?:milk|cheese|butter|cream|yogurt|yoghurt)\\b", ingredient):
                continue
            if any(ingredient_mentioned(ingredient, x) for x in _ANIMAL_PRODUCTS):
                return False
        return True
    return False


'''


def update_algorithm(src: str) -> str:
    src = replace_once(src, 'from collections import Counter', 'import re\nfrom collections import Counter', 'algorithm regex import')
    src = replace_once(src, 'def eligible(recipe, kind, preferences):',
        DIET_CODE + 'def eligible(recipe, kind, preferences):', 'dietary compatibility helper')
    src = replace_once(src,
        'if preferences.get("food_type") == "vegetarian" and find_non_vegetarian_ingredients(ingredients):',
        'if not diet_compatible(ingredients, preferences.get("food_type", "any")):',
        'dietary check inside eligible')
    src = replace_once(src,
        'today=None, eaters_for_slot=None):',
        'today=None, eaters_for_slot=None, preferences_for_slot=None):',
        'optional slot preferences in generator signature')
    src = replace_once(src,
        '"""The optional serving resolver can later consume authoritative attendance data."""',
        '"""Generate using optional date/meal attendance and dietary resolvers."""',
        'generator documentation')
    src = replace_once(src,
        'chosen = choose_recipe(pools[kind], candidate, result, result, recipes, stock,',
        '''slot_pool = (\n            [recipe for recipe in pools[kind]
             if eligible(recipe, kind, preferences_for_slot(day, kind))]
            if preferences_for_slot else pools[kind]
        )
        if not slot_pool:
            raise PlanningError(
                f"No {kind} recipes satisfy all attending family members on {day}. "
                "Try a different diet selection or add suitable recipes."
            )
        chosen = choose_recipe(slot_pool, candidate, result, result, recipes, stock,''',
        'slot-specific recipe filtering')
    # At replacement time, family restrictions are injected into preferences
    # by API validation. This keeps the existing choose_recipe method intact.
    src = replace_once(src,
        'pool = [recipe for recipe in recipes_data if eligible(recipe, current["meal_type"], preferences)]',
        '''slot_preferences = preferences.get("_slot_preferences", {}).get(
        (current["meal_date"], current["meal_type"]), preferences
    )
    pool = [recipe for recipe in recipes_data
            if eligible(recipe, current["meal_type"], slot_preferences)]''',
        'replacement respects slot diet')
    return src


FAMILY_API_HELPERS = '''# Family Management is the authoritative source when attendance is enabled.
# The default household setting is preserved when family attendance is off.
_DIET_RANK = {"any": 0, "non-vegetarian": 0, "eggitarian": 1,
              "vegetarian": 2, "vegan": 3}


def slot_context(c, day, kind, size, preferences):
    """Return effective servings and the strictest attending dietary choice."""
    result = {"eaters": size, "preferences": dict(preferences)}
    if not family_state(c)["attendance_enabled"]:
        return result
    slot = attendance_for_slot(c, date.fromisoformat(day), kind)
    ids = slot["selected_member_ids"]
    if not ids:
        # The existing database requires one or more eaters per planned meal.
        # Never silently turn zero attendees into a phantom serving.
        raise PlanningError(
            f"No one is attending {kind} on {day}. "
            "Select an attendee in Family Management before generating all 21 meals."
        )
    slots = ",".join("?" for _ in ids)
    member_diets = [row[0] for row in c.execute(
        f"SELECT dietary_preference FROM family_members WHERE enabled=1 AND id IN ({slots})", ids
    )]
    requested = result["preferences"].get("food_type", "any")
    chosen = requested
    for member_diet in member_diets:
        if _DIET_RANK.get(member_diet, -1) < 0:
            raise PlanningError("An attending family member has an unknown dietary preference.")
        if _DIET_RANK[member_diet] > _DIET_RANK.get(chosen, 0):
            chosen = member_diet
    result["eaters"] = len(ids)
    result["preferences"]["food_type"] = chosen
    return result


def validate_family_preview(c, meals, existing, recipes, size, preferences):
    """Check current attendance and diet again for Replace and Save requests."""
    if not family_state(c)["attendance_enabled"]:
        return
    completed = {(m["meal_date"], m["meal_type"])
                 for m in existing if m.get("completed_at")}
    slot_preferences = {}
    for meal in meals:
        key = (meal["meal_date"], meal["meal_type"])
        if key in completed:
            continue  # History and already-deducted meals are immutable.
        try:
            context = slot_context(c, *key, size, preferences)
        except PlanningError as error:
            raise HTTPException(409, str(error)) from error
        slot_preferences[key] = context["preferences"]
        if int(meal["eaters"]) != int(context["eaters"]):
            raise HTTPException(409,
                f"Family attendance changed for {key[0]} {key[1]}. Generate a fresh preview.")
        recipe = recipes.get(meal["recipe_id"]) if isinstance(recipes, dict) else next(
            (r for r in recipes if r["id"] == meal["recipe_id"]), None
        )
        if not recipe or not eligible(recipe, key[1], context["preferences"]):
            raise HTTPException(409,
                f"Dietary preferences changed for {key[0]} {key[1]}. Generate a fresh preview.")
    # The existing replace_meal() uses this to choose a valid alternative.
    preferences["_slot_preferences"] = slot_preferences


'''


def update_api(src: str) -> str:
    src = replace_once(src, 'from db import connection\n',
        'from db import connection\nfrom family_management import attendance_for_slot, family_state\n',
        'family imports')
    src = replace_once(src,
        'food_type: Literal["any", "vegetarian"] = "any"',
        'food_type: Literal["any", "vegetarian", "vegan", "non-vegetarian", "eggitarian"] = "any"',
        'API dietary literals')
    src = replace_once(src,
        'def helpers():', FAMILY_API_HELPERS + 'def helpers():',
        'family attendance helpers')
    src = replace_once(src,
        'result = generate_week(data.start, recipes, stock, existing, size, preferences, data.seed)',
        '''result = generate_week(
                data.start, recipes, stock, existing, size, preferences, data.seed,
                eaters_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["eaters"],
                preferences_for_slot=lambda day, kind: slot_context(c, day, kind, size, preferences)["preferences"],
            )''',
        'attendance-aware generation call')
    src = replace_once(src,
        '"household_size": size, "mode": "local-smart-planning"}',
        '"household_size": size, "attendance_enabled": family_state(c)["attendance_enabled"], "mode": "local-smart-planning"}',
        'attendance badge in preview response')
    # The generator's data response is outside `with connection() as c:`.
    # Read family config using a fresh connection instead of leaking a closed c.
    src = replace_once(src,
        '"attendance_enabled": family_state(c)["attendance_enabled"], "mode": "local-smart-planning"}',
        '"attendance_enabled": attendance_is_enabled(), "mode": "local-smart-planning"}',
        'safe response helper')
    src = replace_once(src, 'def helpers():',
        '''def attendance_is_enabled():
    with connection() as c:
        return family_state(c)["attendance_enabled"]


def helpers():''',
        'attendance response helper')
    # Validate incoming previews on both Replace and Save before any writes.
    match = 'incoming = normalized_meals(data, existing, recipes, preferences)'
    count = src.count(match)
    if count != 2:
        raise ValueError(f'Expected 2 Replace/Save validation hooks; found {count}. No changes applied.')
    src = src.replace(match,
        match + '\n        validate_family_preview(c, incoming, existing, recipes, size, preferences)')
    return src


def detect_root():
    root = Path.cwd()
    if len(sys.argv) > 1:
        root = Path(sys.argv[1]).expanduser()
    if not all((root / file).is_file() for file in REQUIRED):
        missing = [str(file) for file in REQUIRED if not (root / file).is_file()]
        raise FileNotFoundError(f'Run from KitchenSync root. Missing: {", ".join(missing)}')
    return root


def main():
    root = detect_root()
    old = {rel: (root / rel).read_text(encoding='utf-8-sig') for rel in REQUIRED}
    transformations = {
        REQUIRED[0]: update_js,
        REQUIRED[1]: update_api,
        REQUIRED[2]: update_algorithm,
    }
    new = {}
    for rel in REQUIRED:
        new[rel] = transformations[rel](old[rel])
        if rel.suffix == '.py':
            ast.parse(new[rel], filename=str(rel))
    # Do not touch any original until ALL three files have passed anchor checks.
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backups = {}
    for rel in REQUIRED:
        path = root / rel
        backup = path.with_name(path.name + f'.before-family-update-{ts}.bak')
        shutil.copy2(path, backup)
        backups[rel] = backup
    try:
        for rel in REQUIRED:
            (root / rel).write_text(new[rel], encoding='utf-8', newline='\n')
    except Exception:
        for rel, backup in backups.items():
            shutil.copy2(backup, root / rel)
        raise
    print('SUCCESS: generated and installed all 3 updated KitchenSync files:')
    for rel in REQUIRED:
        print(f'  {rel} (backup: {backups[rel].name})')
    print('No Git staging, commit, merge, or push was performed.')
    print('Next: python -m unittest discover -s tests -v')
    print('Next: cd frontend && npm.cmd run build')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'STOPPED SAFELY: {exc}', file=sys.stderr)
        sys.exit(1)
