import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_FAMILY_PROFILE_KEY,
  readActiveFamilyProfileId,
  resolveActiveFamilyProfile,
  saveActiveFamilyProfileId,
} from './familyProfile.js';

const members = [
  { id: 2, name: 'Ayush', enabled: true },
  { id: 7, name: 'Dhruv', enabled: false },
  { id: 12, name: 'Aditi', enabled: true },
];
function makeStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('selects enabled family members only', () => {
  assert.equal(resolveActiveFamilyProfile(members, 2)?.name, 'Ayush');
  assert.equal(resolveActiveFamilyProfile(members, 12)?.name, 'Aditi');
  assert.equal(resolveActiveFamilyProfile(members, 7), null);
  assert.equal(resolveActiveFamilyProfile(members, 99), null);
});

test('rejects invalid IDs or missing roster', () => {
  for (const id of [null, undefined, '', 0, -1, NaN, 'nope', 2.5, '02']) {
    assert.equal(resolveActiveFamilyProfile(members, id), null);
  }
  assert.equal(resolveActiveFamilyProfile([], 2), null);
  assert.equal(resolveActiveFamilyProfile(undefined, 2), null);
});

test('saves profile per storage and clears it on sign-out', () => {
  const storage = makeStorage();
  assert.equal(readActiveFamilyProfileId(storage), null);
  assert.equal(saveActiveFamilyProfileId(storage, 12), true);
  assert.equal(readActiveFamilyProfileId(storage), 12);
  assert.equal(storage.getItem(ACTIVE_FAMILY_PROFILE_KEY), '12');
  assert.equal(saveActiveFamilyProfileId(storage, null), true);
  assert.equal(readActiveFamilyProfileId(storage), null);
});

test('invalid IDs never get persisted', () => {
  const storage = makeStorage();
  for (const id of [0, -2, '1', 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(saveActiveFamilyProfileId(storage, id), false);
  }
  assert.equal(storage.getItem(ACTIVE_FAMILY_PROFILE_KEY), null);
  storage.setItem(ACTIVE_FAMILY_PROFILE_KEY, '02');
  assert.equal(readActiveFamilyProfileId(storage), null);
  storage.setItem(ACTIVE_FAMILY_PROFILE_KEY, '99999999999999999999');
  assert.equal(readActiveFamilyProfileId(storage), null);
});

test('storage unavailable or blocked never crashes', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readActiveFamilyProfileId(blocked), null);
  assert.equal(saveActiveFamilyProfileId(blocked, 2), false);
  assert.equal(saveActiveFamilyProfileId(blocked, null), false);
  assert.equal(readActiveFamilyProfileId(null), null);
});

test('deleted or disabled profiles cannot be resolved from saved ID', () => {
  const storage = makeStorage();
  saveActiveFamilyProfileId(storage, 2);
  assert.equal(resolveActiveFamilyProfile(members, readActiveFamilyProfileId(storage))?.name, 'Ayush');
  assert.equal(resolveActiveFamilyProfile(members.filter(m => m.id !== 2), readActiveFamilyProfileId(storage)), null);
  assert.equal(resolveActiveFamilyProfile(members.map(m => ({...m, enabled: false})), readActiveFamilyProfileId(storage)), null);
});
