import assert from 'node:assert/strict';
import { DIETARY_OPTIONS, preferenceOf, dietaryLabel } from './familyDiet.js';

assert.deepEqual(DIETARY_OPTIONS.map(o => o.value),
  ['vegetarian', 'non-vegetarian', 'eggitarian', 'vegan']);
for (const option of DIETARY_OPTIONS) {
  assert.equal(preferenceOf({ dietary_preference: option.value }), option.value);
  assert.equal(dietaryLabel(option.value), option.label);
}
assert.equal(preferenceOf({ vegetarian: true }), 'vegetarian');
assert.equal(preferenceOf({ vegetarian: false }), 'non-vegetarian');
assert.equal(preferenceOf(null), 'non-vegetarian');
console.log('12 dietary preference UI checks passed');
