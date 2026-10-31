import assert from 'node:assert/strict';
import {
  packUnitsFor, offerKey, normalizeOfferPrice, sortOffersByValue,
  formatNormalizedPrice, createManualOffer,
} from './priceUtils.js';

assert.deepEqual(packUnitsFor('g').map((x) => x.value), ['g', 'kg']);
assert.deepEqual(packUnitsFor('ml').map((x) => x.value), ['ml', 'L']);
assert.deepEqual(packUnitsFor('pcs').map((x) => x.value), ['pcs']);
assert.equal(offerKey(' Paneer ', 'g'), 'paneer::g');
assert.equal(normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: 500, price: 120 }).pricePerUnit, 240);
assert.equal(normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'kg', packQuantity: 2, price: 400 }).pricePerUnit, 200);
assert.equal(normalizeOfferPrice({ inventoryUnit: 'ml', packUnit: 'ml', packQuantity: 500, price: 70 }).pricePerUnit, 140);
assert.equal(normalizeOfferPrice({ inventoryUnit: 'ml', packUnit: 'L', packQuantity: 2, price: 210 }).pricePerUnit, 105);
assert.equal(normalizeOfferPrice({ inventoryUnit: 'pcs', packUnit: 'pcs', packQuantity: 12, price: 60 }).pricePerUnit, 5);
assert.throws(() => normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'L', packQuantity: 1, price: 20 }), /not compatible/);
assert.throws(() => normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: 0, price: 20 }), /quantity/);
assert.throws(() => normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: 500, price: 0 }), /price/);
assert.throws(() => normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: '', price: 20 }), /quantity/);
assert.throws(() => normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: 200, price: '' }), /price/);
const now = '2026-10-31T06:00:00.000Z';
const first = createManualOffer({ item: { name: 'Paneer', unit: 'g' }, store: ' Shop A ', packUnit: 'g', packQuantity: 500, price: 120 }, 'a', now);
assert.equal(first.source, 'manual');
assert.equal(first.store, 'Shop A');
assert.equal(first.recordedAt, now);
const second = createManualOffer({ item: { name: 'Paneer', unit: 'g' }, store: 'Shop B', packUnit: 'kg', packQuantity: 2, price: 400 }, 'b', now);
assert.deepEqual(sortOffersByValue([first, second], 'paneer::g').map((x) => x.id), ['b', 'a']);
assert.equal(sortOffersByValue([first, second], 'onion::g').length, 0);
assert.match(formatNormalizedPrice(normalizeOfferPrice({ inventoryUnit: 'g', packUnit: 'g', packQuantity: 500, price: 120 })), /240.*kg/);
assert.throws(() => createManualOffer({ item: { name: 'Paneer', unit: 'g' }, store: '', packUnit: 'g', packQuantity: 500, price: 120 }, 'c', now), /store/);
console.log('priceUtils: all 21 assertions passed');
