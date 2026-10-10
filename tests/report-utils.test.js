import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTENDANCE_EXPORT_COLUMNS, attendanceCsvText, buildConsolidatedAttendanceSheets } from '../src/report-utils.js';

test('attendance CSV and XLSX field definitions contain no student identifier', () => {
  assert.deepEqual(ATTENDANCE_EXPORT_COLUMNS.map(([label]) => label), [
    'Student name', 'Course', 'Group', 'Date', 'Start time', 'End time', 'Room', 'Status', 'Instructor'
  ]);
  const csv = attendanceCsvText([{ student: 'Ali Əliyev', student_id: 'legacy-id', course: 'Python', group_name: 'Group 1', status: '=HYPERLINK("x")' }]);
  assert.match(csv, /^"Student name","Course","Group"/);
  assert.match(csv, /"Ali Əliyev"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.doesNotMatch(csv, /Student ID|legacy-id/);
});

test('consolidated workbook sheets summarize students and sessions without identifiers', () => {
  const rows = [
    { student: 'Ali Əliyev', course: 'Python', group_name: 'Group 2', session_id: 's1', session_date: '2026-09-26', start_time: '10:00', end_time: '11:00', room: 'B204', instructor: 'Jordan Trainer', status: 'present' },
    { student: 'Nigar Məmmədova', course: 'Python', group_name: 'Group 2', session_id: 's1', session_date: '2026-09-26', start_time: '10:00', end_time: '11:00', room: 'B204', instructor: 'Jordan Trainer', status: 'absent' },
    { student: 'Ali Əliyev', course: 'Python', group_name: 'Group 2', session_id: 's2', session_date: '2026-09-29', start_time: '10:00', end_time: '11:00', room: 'B204', instructor: 'Jordan Trainer', status: 'absent' }
  ];
  const sheets = buildConsolidatedAttendanceSheets(rows);
  assert.deepEqual(Object.keys(sheets), ['Attendance', 'Students', 'Session Summary']);
  assert.deepEqual(sheets.Attendance[0], ['Student name', 'Course', 'Group', '2026-09-26 · Group 2 · 10:00', '2026-09-29 · Group 2 · 10:00', 'Absent', 'Attendance %']);
  assert.deepEqual(sheets.Attendance[1], ['Ali Əliyev', 'Python', 'Group 2', 'present', 'absent', 1, 50]);
  assert.deepEqual(sheets.Students[2], ['Nigar Məmmədova', 'Python', 'Group 2', 0, 1, 0]);
  assert.deepEqual(sheets['Session Summary'][1], ['2026-09-26', 'Python', 'Group 2', '10:00', '11:00', 'B204', 'Jordan Trainer', 2, 1, 1, 50]);
  assert.doesNotMatch(JSON.stringify(sheets), /student_id|Student ID/);
});
