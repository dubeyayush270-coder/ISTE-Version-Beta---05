"""Deterministic cooking and stock calculations. The AI must never do arithmetic."""
from collections import defaultdict
from datetime import date, datetime, timedelta


def scale_ingredients(recipe, eaters):
    factor = eaters / recipe['base_servings']
    return [{"name": name, "quantity": round(amount * factor, 2), "unit": unit}
            for name, amount, unit in recipe['ingredients']]


def stock_available(item, today=None, now=None):
    """Conservative treatment of expired items and leftovers for stock planning."""
    today = today or date.today()
    now = now or datetime.now()
    if item.get('expiry_date') and date.fromisoformat(item['expiry_date']) < today:
        return False
    if item.get('is_leftover'):
        # Conservative demo rule, NOT a food safety certification.
        if item.get('storage') != 'refrigerated' or not item.get('prepared_at'):
            return False
        try:
            prepared = datetime.fromisoformat(item['prepared_at'])
            local_now = datetime.now(prepared.tzinfo) if prepared.tzinfo else now
            elapsed = local_now - prepared
        except ValueError:
            return False
        if elapsed < timedelta(0) or elapsed > timedelta(hours=24):
            return False
    return True


def inventory_map(items, today=None):
    return {i['name'].casefold(): i for i in items if stock_available(i, today)}


def audit_meals(meals, recipes_by_id, stock, today=None):
    """Simulate planned meals chronologically, excluding already-completed meals."""
    remaining = {k: float(v['quantity']) for k,v in inventory_map(stock,today).items()}
    warnings = []
    needs = defaultdict(lambda: {'required': 0.0,'available':0.0,'missing':0.0,'unit':None})
    for meal in sorted(meals, key=lambda m: (m['meal_date'], ['breakfast','lunch','dinner'].index(m['meal_type']))):
        if meal.get('completed_at'):
            continue
        recipe = recipes_by_id[meal['recipe_id']]
        for ingredient in scale_ingredients(recipe,meal['eaters']):
            name, unit, q = ingredient['name'], ingredient['unit'], ingredient['quantity']
            key = name.casefold()
            entry = stock_entry = next((s for s in stock if s['name'].casefold()==key),None)
            mismatch = entry is not None and entry['unit'] != unit
            existing = 0.0 if mismatch else remaining.get(key,0.0)
            used = min(existing,q)
            deficit = round(q-used,2)
            if existing >= 0 and not mismatch:
                remaining[key] = max(0.0,existing-q)
            req = needs[key]
            req['required'] += q
            req['available'] += used
            req['missing'] += deficit
            req['unit'] = unit
            req['name'] = name
            if deficit > 0:
                warnings.append({"date":meal['meal_date'],"meal_type":meal['meal_type'],"recipe":recipe['name'],"ingredient":name,"missing":deficit,"unit":unit,"reason":"Unit mismatch" if mismatch else "Insufficient usable stock"})
    shopping = [{**v,'required':round(v['required'],2),'available':round(v['available'],2),'missing':round(v['missing'],2)}
                for v in needs.values() if v['missing'] > 0]
    return {'warnings': warnings, 'shopping':sorted(shopping,key=lambda x:x['name'])}
