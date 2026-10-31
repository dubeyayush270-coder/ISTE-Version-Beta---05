// Shopping calculations are driven by the backend's batch-aware /api/stock-check.
// Do not recalculate stock availability in the browser: expiry and meal order matter.

export const SHOPPING_UNITS = new Set(['g', 'ml', 'pcs']);

export function shoppingKey(name, unit) {
  return `${String(name || '').trim().toLocaleLowerCase()}::${String(unit || '').trim().toLowerCase()}`;
}

export function normalizedShoppingRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      name: String(row.name || '').trim(),
      unit: String(row.unit || '').trim().toLowerCase(),
      required: Number(row.required) || 0,
      available: Number(row.available) || 0,
      missing: Number(row.missing) || 0,
    }))
    .filter((row) => row.name && SHOPPING_UNITS.has(row.unit) && Number.isFinite(row.missing) && row.missing > 0)
    .map((row) => ({ ...row, key: shoppingKey(row.name, row.unit) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findPantryMatch(inventory, name) {
  const target = String(name || '').trim().toLocaleLowerCase();
  return (Array.isArray(inventory) ? inventory : []).find(
    (item) => String(item.name || '').trim().toLocaleLowerCase() === target
  ) || null;
}

export function makePurchaseRequest(item, inventory, quantity, expiryDate = '', dateType = 'expiry') {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new Error('Enter a purchased quantity greater than zero and no more than 1,000,000.');
  }
  if (!item?.name?.trim() || !SHOPPING_UNITS.has(item.unit)) {
    throw new Error('This ingredient has a missing name or unsupported unit.');
  }
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    throw new Error('Please enter a valid date.');
  }
  const existing = findPantryMatch(inventory, item.name);
  if (existing && existing.unit !== item.unit) {
    throw new Error(`${item.name} already exists as ${existing.unit}. Adjust its unit in Pantry before adding a purchase.`);
  }
  if (existing?.is_leftover) {
    throw new Error(`${item.name} is currently marked as cooked leftovers. Review it in Pantry before adding groceries.`);
  }
  const recognizedDateType = expiryDate ? dateType : 'unknown';
  if (!['expiry', 'use_by', 'best_before', 'unknown'].includes(recognizedDateType)) {
    throw new Error('Choose the date type printed on the package.');
  }
  const metadata = {
    quantity: amount,
    expiry_date: expiryDate || null,
    date_type: recognizedDateType,
    date_source: 'manual',
    // Do not pretend a manually typed purchase was scanned.
    barcode: null,
  };
  if (existing) {
    return {
      path: `/inventory/${existing.id}/batches`,
      body: metadata,
      kind: 'batch',
    };
  }
  return {
    path: '/inventory',
    body: {
      name: item.name.trim(),
      unit: item.unit,
      ...metadata,
      is_leftover: false,
      prepared_at: null,
      storage: null,
    },
    kind: 'ingredient',
  };
}

export function amountLabel(value, unit) {
  const number = Number(value);
  return `${Number.isFinite(number) ? Number(number.toFixed(2)).toLocaleString('en-IN') : '0'} ${unit}`;
}

export function checklistKey(weekStart) {
  return `kitchensync:shopping:v1:${String(weekStart || 'current').slice(0, 10)}`;
}
