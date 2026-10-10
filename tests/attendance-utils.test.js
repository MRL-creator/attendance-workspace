import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentAttendanceHistory, studentAbsenceDates, summarizeAttendanceHistory } from '../src/attendance-utils.js';

const sessions = [
  { id: 'session-2', session_date: '2026-09-29' },
  { id: 'session-1', session_date: '2026-09-26' }
];

test('attendance history uses each session roster without adding later students to old sessions', () => {
  const students = [{ id: 'a', full_name: 'Ali Əliyev', active: 1 }, { id: 'b', full_name: 'Nigar Məmmədova', active: 1 }];
  const rosters = [
    [{ student_key: 'a', full_name: 'Ali Əliyev', status: 'present', active: 1 }],
    [{ student_key: 'a', full_name: 'Ali Əliyev', status: 'absent', active: 1 }, { student_key: 'b', full_name: 'Nigar Məmmədova', status: 'present', active: 1 }]
  ];
  const history = buildStudentAttendanceHistory(students, sessions, rosters);
  assert.deepEqual([...history.find(student => student.id === 'a').marks], [['session-2', 'present'], ['session-1', 'absent']]);
  assert.equal(history.find(student => student.id === 'b').marks.size, 1);
  assert.deepEqual(studentAbsenceDates(history.find(student => student.id === 'a'), sessions, value => value), ['2026-09-26']);
});

test('attendance totals and percentage are based on recorded roster marks', () => {
  const history = buildStudentAttendanceHistory(
    [{ id: 'a', full_name: 'Ali Əliyev' }, { id: 'b', full_name: 'Nigar Məmmədova' }],
    sessions,
    [
      [{ student_key: 'a', full_name: 'Ali Əliyev', status: 'present' }],
      [{ student_key: 'a', full_name: 'Ali Əliyev', status: 'absent' }, { student_key: 'b', full_name: 'Nigar Məmmədova', status: 'present' }]
    ]
  );
  assert.deepEqual(summarizeAttendanceHistory(history), { present: 2, absent: 1, total: 3, percentage: 67 });
});
