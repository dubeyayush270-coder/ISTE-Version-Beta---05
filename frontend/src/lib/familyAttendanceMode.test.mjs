import assert from 'node:assert/strict';
import { canEnableFamilyAttendance, sameAttendees } from './familyAttendanceMode.js';

assert.equal(canEnableFamilyAttendance([]), false);
assert.equal(canEnableFamilyAttendance([{ id: 1, enabled: false }]), false);
assert.equal(canEnableFamilyAttendance([{ id: 1, enabled: false }, { id: 2, enabled: true }]), true);
assert.equal(canEnableFamilyAttendance(undefined), false);
assert.equal(sameAttendees([2, 1], [1, 2]), true);
assert.equal(sameAttendees([], []), true);
assert.equal(sameAttendees([1], [2]), false);
assert.equal(sameAttendees([1, 1], [1, 2]), false);
assert.equal(sameAttendees([1], undefined), false);
assert.equal(sameAttendees(undefined, []), true);
console.log('10 family attendance mode assertions passed');
