import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const token = 'milestone-2-test-token';
const origin = 'https://attendance.test';
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const tokenHash = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

class MockD1 {
  constructor({ roles, permissions, groupCourse = 'course-1', instructors = {}, assignments = [], students = [] }) {
    this.auth = { id: 'actor-1', email: 'actor@example.org', full_name: 'Test Actor', role: roles[0], active: 1, must_change_password: 0, expires_at: Math.floor(Date.now() / 1000) + 3600, roles: roles.join(','), permissions: permissions.join(','), theme: 'system' };
    this.groupCourse = groupCourse;
    this.instructors = instructors;
    this.assignments = new Set(assignments.map(value => value.join('|')));
    this.currentStudents = students;
    this.sessions = [];
    this.attendance = [];
    this.userPermissionRecords = [];
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.includes('FROM auth_sessions s JOIN users u')) return values[0] === database.auth.token_hash ? database.auth : null;
            if (sql.includes('FROM courses WHERE id=? AND active=1')) return values[0] === 'course-1' ? { id: values[0] } : null;
            if (sql.includes('FROM groups WHERE id=? AND active=1')) return values[0] === 'group-1' ? { course_id: database.groupCourse } : null;
            if (sql.includes('FROM users u WHERE u.id=?')) return database.instructors[values[0]] || null;
            if (sql.includes('FROM instructor_assignments WHERE instructor_id=?')) return database.assignments.has(values.join('|')) ? { id: 'assignment-1' } : null;
            throw new Error(`Unexpected first() query: ${sql}`);
          },
          async all() {
            if (sql.includes('FROM students WHERE group_id=? AND active=1')) return { results: database.currentStudents };
            throw new Error(`Unexpected all() query: ${sql}`);
          },
          async run() {
            if (sql.includes('INSERT INTO sessions(')) database.sessions.push(values);
            else if (sql.includes('INSERT INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by)')) database.attendance.push({ sql, values });
            else if (sql.includes('DELETE FROM user_permissions')) database.userPermissionRecords = [];
            else if (sql.includes('INSERT INTO user_permissions')) database.userPermissionRecords.push(values);
            else if (!sql.includes('INSERT INTO audit_logs(')) throw new Error(`Unexpected run() query: ${sql}`);
            return { meta: { changes: 1 } };
          }
        };
      }
    };
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
  }
}

async function requestSession({ user, instructor, assigned = false, groupCourse = 'course-1', includeToken = true, students = [] }) {
  const permissions = user === 'admin' ? ['sessions.create', 'sessions.update', 'settings.manage'] : ['sessions.create', 'sessions.update'];
  const roles = user === 'admin' ? ['admin'] : ['instructor'];
  const selectedInstructor = instructor || (user === 'admin' ? 'instructor-2' : 'actor-1');
  const database = new MockD1({
    roles,
    permissions,
    groupCourse,
    students,
    instructors: {
      'instructor-2': { active: 1, instructor_role: 1 },
      'instructor-3': { active: 1, instructor_role: 1 },
      'actor-1': { active: 1, instructor_role: user === 'instructor' ? 1 : 0 },
      'inactive-instructor': { active: 0, instructor_role: 1 },
      'staff-without-instructor-role': { active: 1, instructor_role: 0 }
    },
    assignments: assigned ? [[selectedInstructor, 'course-1', 'group-1']] : []
  });
  const authHash = await tokenHash(token);
  database.auth.token_hash = authHash;
  const headers = new Headers({ origin, 'content-type': 'application/json' });
  if (includeToken) headers.set('cookie', `attendance_session=${token}`);
  const response = await worker.fetch(new Request(`${origin}/api/sessions`, {
    method: 'POST', headers,
    body: JSON.stringify({ course_id: 'course-1', group_id: 'group-1', session_date: '2026-10-03', start_time: '10:00', end_time: '11:00', instructor_id: selectedInstructor })
  }), { DB: database, ASSETS: { fetch: async () => new Response('') } }, {});
  return { response, database };
}

test('administrator can create sessions with different active, unassigned instructors', async () => {
  const { response, database } = await requestSession({ user: 'admin' });
  assert.equal(response.status, 201);
  assert.equal(database.sessions[0][3], 'instructor-2');
  const second = await requestSession({ user: 'admin', instructor: 'instructor-3' });
  assert.equal(second.response.status, 201);
  assert.equal(second.database.sessions[0][3], 'instructor-3');
});

test('instructors can create sessions only in assigned groups', async () => {
  const denied = await requestSession({ user: 'instructor' });
  assert.equal(denied.response.status, 403);
  const allowed = await requestSession({ user: 'instructor', assigned: true });
  assert.equal(allowed.response.status, 201);
  assert.equal(allowed.database.sessions[0][3], 'actor-1');
});

test('session creation rejects inactive instructors, non-instructors, and mismatched course/group pairs', async () => {
  assert.equal((await requestSession({ user: 'admin', instructor: 'inactive-instructor' })).response.status, 400);
  assert.equal((await requestSession({ user: 'admin', instructor: 'staff-without-instructor-role' })).response.status, 400);
  assert.equal((await requestSession({ user: 'admin', groupCourse: 'different-course' })).response.status, 400);
});

test('session creation API rejects requests without authentication', async () => {
  const { response } = await requestSession({ user: 'admin', includeToken: false });
  assert.equal(response.status, 401);
});

test('session creation snapshots each current student name and absent status', async () => {
  const { response, database } = await requestSession({ user: 'admin', students: [{ id: 'student-1', full_name: 'Ali Əliyev' }, { id: 'student-2', full_name: 'Nigar Məmmədova' }] });
  assert.equal(response.status, 201);
  assert.equal(database.attendance.length, 2);
  assert.deepEqual(database.attendance.map(row => row.values[2]), ['student-1', 'student-2']);
  assert.deepEqual(database.attendance.map(row => row.values[3]), ['Ali Əliyev', 'Nigar Məmmədova']);
  assert.ok(database.attendance.every(row => row.sql.includes("'absent'")));
});

test('sensitive deletion and backup endpoints enforce capabilities server-side', async () => {
  const database = new MockD1({ roles: ['instructor'], permissions: ['students.read','attendance.read'] });
  database.auth.token_hash = await tokenHash(token);
  const headers = new Headers({ origin, cookie: `attendance_session=${token}`, 'content-type': 'application/json' });
  const env = { DB: database, ASSETS: { fetch: async () => new Response('') } };
  const deleteStudents = await worker.fetch(new Request(`${origin}/api/students/delete-selected`, { method: 'POST', headers, body: JSON.stringify({ student_ids: ['student-1'] }) }), env, {});
  assert.equal(deleteStudents.status, 403);
  const deleteAttendance = await worker.fetch(new Request(`${origin}/api/attendance/delete-selected`, { method: 'POST', headers, body: JSON.stringify({ attendance_ids: ['attendance-1'] }) }), env, {});
  assert.equal(deleteAttendance.status, 403);
  const readBackups = await worker.fetch(new Request(`${origin}/api/backups`, { headers }), env, {});
  assert.equal(readBackups.status, 403);
});

test('administrators can persist only supported additional instructor capabilities', async () => {
  const database = new MockD1({ roles: ['admin'], permissions: ['users.update'], instructors: { target: { id: 'target', full_name: 'Test Instructor', roles: 'instructor' } } });
  database.auth.token_hash = await tokenHash(token);
  const headers = new Headers({ origin, cookie: `attendance_session=${token}`, 'content-type': 'application/json' });
  const env = { DB: database, ASSETS: { fetch: async () => new Response('') } };
  const accepted = await worker.fetch(new Request(`${origin}/api/users/target/permissions`, { method: 'PUT', headers, body: JSON.stringify({ permissions: ['students.delete','attendance.delete','reports.export'] }) }), env, {});
  assert.equal(accepted.status, 200);
  assert.deepEqual(database.userPermissionRecords.map(row => row[1]), ['students.delete','attendance.delete','reports.export']);
  const rejected = await worker.fetch(new Request(`${origin}/api/users/target/permissions`, { method: 'PUT', headers, body: JSON.stringify({ permissions: ['backups.manage'] }) }), env, {});
  assert.equal(rejected.status, 400);
});
