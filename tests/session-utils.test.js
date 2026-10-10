import test from 'node:test';
import assert from 'node:assert/strict';
import { canAssignSessionInstructor } from '../src/session-utils.js';

test('administrators with assignment authority can select active instructors outside current assignments', () => {
  assert.equal(canAssignSessionInstructor({ active: true, instructorRole: true, adminOverride: true, assigned: false }), true);
});

test('instructors need a current course and group assignment', () => {
  assert.equal(canAssignSessionInstructor({ active: true, instructorRole: true, adminOverride: false, assigned: true }), true);
  assert.equal(canAssignSessionInstructor({ active: true, instructorRole: true, adminOverride: false, assigned: false }), false);
});

test('inactive accounts and accounts without the instructor role cannot own sessions', () => {
  assert.equal(canAssignSessionInstructor({ active: false, instructorRole: true, adminOverride: true, assigned: true }), false);
  assert.equal(canAssignSessionInstructor({ active: true, instructorRole: false, adminOverride: true, assigned: true }), false);
});
