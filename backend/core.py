
"""Deterministic cooking and stock calculations. The AI must never do arithmetic."""

from collections import defaultdict
from datetime import date, datetime, timedelta


def scale_ingredients(recipe, eaters):
    factor = eaters / recipe["base_servings"]

    return [
        {
            "name": name,
            "quantity": round(amount * factor, 2),
            "unit": unit,
        }
        for name, amount, unit in recipe["ingredients"]
    ]


def stock_available(item, today=None, now=None):
    """
    Check date and leftover safety rules.

    For purchase batches, the caller should supply the
    individual batch expiry_date, not the ingredient's
    summary expiry_date.
    """
    today = today or date.today()
    now = now or datetime.now()

    if item.get("expiry_date"):
        if date.fromisoformat(item["expiry_date"]) < today:
            return False

    if item.get("is_leftover"):
        if (
            item.get("storage") != "refrigerated"
            or not item.get("prepared_at")
        ):
            return False

        try:
            prepared = datetime.fromisoformat(
                item["prepared_at"]
            )

            local_now = (
                datetime.now(prepared.tzinfo)
                if prepared.tzinfo
                else now
            )

            elapsed = local_now - prepared

        except (ValueError, TypeError):
            return False

        if (
            elapsed < timedelta(0)
            or elapsed > timedelta(hours=24)
        ):
            return False

    return True


def inventory_map(items, today=None):
    """
    Map ingredients by name using only cookable quantities.

    Batch-aware inventory items contain usable_quantity.
    Older stock records without that field retain their
    original behavior.
    """
    result = {}

    for item in items:
        key = item["name"].casefold()

        if "usable_quantity" in item:
            usable = float(item["usable_quantity"])

            if usable <= 0:
                continue

            entry = dict(item)
            entry["quantity"] = usable
            result[key] = entry

        elif stock_available(item, today):
            result[key] = item

    return result


def audit_meals(meals, recipes_by_id, stock, today=None):
    """
    Simulate planned meals chronologically, excluding
    completed meals.

    Use usable quantities rather than physical totals.
    """
    remaining = {
        key: float(item["quantity"])
        for key, item in inventory_map(
            stock, today
        ).items()
    }
    today = today or date.today()

    by_name = {
        item["name"].casefold(): item
        for item in stock
    }

    batch_remaining = {}

    for key, item in by_name.items():
        if item.get("batches"):
            batch_remaining[key] = sorted(
                [
                    {
                        **batch,
                        "remaining": float(batch["quantity"]),
                    }
                    for batch in item["batches"]
                    if float(batch["quantity"]) > 0
                ],
                key=lambda batch: (
                    batch.get("expiry_date") is None,
                    batch.get("expiry_date") or "9999-12-31",
                    batch.get("id", 0),
                ),
            )


    warnings = []

    needs = defaultdict(
        lambda: {
            "required": 0.0,
            "available": 0.0,
            "missing": 0.0,
            "unit": None,
        }
    )

    meal_order = {
        "breakfast": 0,
        "lunch": 1,
        "dinner": 2,
    }

    ordered_meals = sorted(
        meals,
        key=lambda meal: (
            meal["meal_date"],
            meal_order[meal["meal_type"]],
        ),
    )

    for meal in ordered_meals:
        if meal.get("completed_at"):
            continue

        recipe = recipes_by_id[meal["recipe_id"]]

        meal_date = max(
            today,
            date.fromisoformat(meal["meal_date"])
        )

        meal_now = (
            datetime.combine(meal_date, datetime.max.time())
            if meal_date > today
            else datetime.now()
        )


        for ingredient in scale_ingredients(
            recipe, meal["eaters"]
        ):
            name = ingredient["name"]
            unit = ingredient["unit"]
            quantity = ingredient["quantity"]
            key = name.casefold()

            entry = next(
                (
                    item for item in stock
                    if item["name"].casefold() == key
                ),
                None,
            )
            mismatch = (
                entry is not None
                and entry["unit"] != unit
            )
            if mismatch:
                used = 0.0
            elif key in batch_remaining:
                eligible = []
                for batch in batch_remaining[key]:
                    if batch["remaining"] <= 0:
                        continue
                    purchase_date = batch.get("purchase_date")
                    if (
                        purchase_date
                        and date.fromisoformat(purchase_date) > meal_date
                    ):
                        continue
                    candidate = dict(entry)
                    candidate["expiry_date"] = batch.get(
                        "expiry_date"
                    )

                    if batch.get("storage") is not None:
                        candidate["storage"] = batch["storage"]

                    if stock_available(
                        candidate,
                        today=meal_date,
                        now=meal_now,
                    ):
                        eligible.append(batch)

                available = sum(
                    batch["remaining"] for batch in eligible
                )
                used = min(quantity, available)

                to_take = used

                for batch in eligible:
                    taken = min(
                        to_take,
                        batch["remaining"]
                    )
                    batch["remaining"] -= taken
                    to_take -= taken

                    if to_take <= 1e-8:
                        break

            else:
                available = remaining.get(key, 0.0)

                if entry is not None and not stock_available(
                    entry,
                    today=meal_date,
                    now=meal_now,
                ):
                    available = 0.0

                used = min(quantity, available)
                remaining[key] = max(
                    0.0,
                    available - used
                )

            deficit = round(quantity - used, 2)


            required = needs[key]
            required["required"] += quantity
            required["available"] += used
            required["missing"] += deficit
            required["unit"] = unit
            required["name"] = name

            if deficit > 0:
                warnings.append({
                    "date": meal["meal_date"],
                    "meal_type": meal["meal_type"],
                    "recipe": recipe["name"],
                    "ingredient": name,
                    "missing": deficit,
                    "unit": unit,
                    "reason": (
                        "Unit mismatch"
                        if mismatch
                        else "Insufficient usable stock"
                    ),
                })

    shopping = [
        {
            **value,
            "required": round(value["required"], 2),
            "available": round(value["available"], 2),
            "missing": round(value["missing"], 2),
        }
        for value in needs.values()
        if value["missing"] > 0
    ]

    return {
        "warnings": warnings,
        "shopping": sorted(
            shopping,
            key=lambda item: item["name"],
        ),
    }
