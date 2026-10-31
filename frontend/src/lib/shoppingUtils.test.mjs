import assert from 'node:assert/strict';
import {
  normalizedShoppingRows, findPantryMatch, makePurchaseRequest, checklistKey,
  isValidCalendarDate, purchaseDateWarning,
} from './shoppingUtils.js';

const shopping = [{ name: 'Paneer', required: 440, available: 200, missing: 240, unit: 'g' },
  { name: 'Peas', required: 160, available: 130, missing: 30, unit: 'g' }];
assert.equal(normalizedShoppingRows(shopping).length, 2);
assert.equal(normalizedShoppingRows(shopping)[0].missing, 240);
assert.equal(normalizedShoppingRows([{ name: 'Rice', missing: 0, unit: 'g' }]).length, 0);
assert.equal(findPantryMatch([{ id: 15, name: 'paneer', unit: 'g' }], 'Paneer').id, 15);
const existing = makePurchaseRequest(shopping[0], [{ id: 15, name: 'Paneer', unit: 'g' }], 250);
assert.equal(existing.path, '/inventory/15/batches');
assert.equal(existing.body.quantity, 250);
assert.equal(existing.body.date_type, 'unknown');
const fresh = makePurchaseRequest(shopping[1], [], 30, '2026-11-08', 'best_before');
assert.equal(fresh.path, '/inventory');
assert.equal(fresh.body.expiry_date, '2026-11-08');
assert.equal(fresh.body.date_type, 'best_before');
assert.throws(() => makePurchaseRequest(shopping[1], [], 0), /quantity/);
assert.throws(() => makePurchaseRequest(shopping[0], [{ id: 4, name: 'Paneer', unit: 'pcs' }], 50), /unit/);
assert.equal(checklistKey('2026-10-31'), 'kitchensync:shopping:v1:2026-10-31');
assert.equal(isValidCalendarDate('2026-02-28'), true);
assert.equal(isValidCalendarDate('2026-02-31'), false);
assert.equal(isValidCalendarDate('2006-10-31'), true);
assert.match(purchaseDateWarning('2006-10-31', new Date(2026, 9, 31)), /already passed/);
assert.equal(purchaseDateWarning('2026-10-31', new Date(2026, 9, 31)), '');
assert.match(purchaseDateWarning('2040-10-31', new Date(2026, 9, 31)), /five years/);
assert.equal(purchaseDateWarning('', new Date(2026, 9, 31)), '');
assert.throws(() => makePurchaseRequest(shopping[1], [], 30, '2026-02-31'), /valid printed date/);
console.log('shoppingUtils: all 21 assertions passed');
