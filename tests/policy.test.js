import test from 'node:test';
import assert from 'node:assert/strict';
import { can, hasRole, isAdmin, isViewer } from '../src/policy.js';

const instructor = { roles: ['instructor'], permissions: ['attendance.read','attendance.create','attendance.update','reports.read','sessions.create'] };
const viewer = { roles: ['viewer'], permissions: ['attendance.read','reports.read','students.read'] };
const adminInstructor = { roles: ['admin','instructor'], permissions: ['students.update','attendance.update','settings.manage'] };
const superAdmin = { roles: ['super_admin'], permissions: [] };

test('instructors receive attendance capabilities but no administration', () => {
  assert.equal(can(instructor,'attendance.create'), true);
  assert.equal(can(instructor,'attendance.update'), true);
  assert.equal(can(instructor,'students.update'), false);
  assert.equal(can(instructor,'settings.manage'), false);
  assert.equal(isAdmin(instructor), false);
});

test('viewers can read but have no write or export capabilities', () => {
  assert.equal(isViewer(viewer), true);
  assert.equal(can(viewer,'attendance.read'), true);
  assert.equal(can(viewer,'reports.read'), true);
  assert.equal(can(viewer,'attendance.update'), false);
  assert.equal(can(viewer,'reports.export'), false);
});

test('one account can combine admin and instructor roles without becoming super admin', () => {
  assert.equal(isAdmin(adminInstructor), true);
  assert.equal(hasRole(adminInstructor,'instructor'), true);
  assert.equal(can(adminInstructor,'students.update'), true);
  assert.equal(can(adminInstructor,'attendance.update'), true);
  assert.equal(can(adminInstructor,'super_admin.manage'), false);
});

test('super admin has all capabilities even when permission rows are absent', () => {
  assert.equal(isAdmin(superAdmin), true);
  assert.equal(can(superAdmin,'users.delete'), true);
  assert.equal(can(superAdmin,'roles.manage'), true);
  assert.equal(can(superAdmin,'super_admin.manage'), true);
});

test('additional instructor capabilities can be granted without changing viewer access', () => {
  const extended = { ...instructor, permissions: [...instructor.permissions, 'students.delete','attendance.delete','reports.export'] };
  assert.equal(can(instructor,'students.delete'), false);
  assert.equal(can(extended,'students.delete'), true);
  assert.equal(can(extended,'attendance.delete'), true);
  assert.equal(can(extended,'reports.export'), true);
  assert.equal(can(viewer,'attendance.delete'), false);
});
