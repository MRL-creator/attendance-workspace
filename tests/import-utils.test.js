import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateStudentNameFlags, mapMatrixToAttendance, mapMatrixToStudents, normalizeStudentName, parseDelimitedText, rowsToTsv } from '../src/import-utils.js';

test('imports student names only and sorts them alphabetically', () => {
  const rows = mapMatrixToStudents([
    ['Student Name', 'Course', 'Group', 'Legacy ID'],
    ['Nigar Məmmədova', 'Ignored course', 'Ignored group', '001'],
    ['Əli Əliyev', 'Other course', 'Other group', '002'],
    ['  Nigar   Məmmədova ', '', '', '003']
  ], { full_name: '0' });
  assert.deepEqual(rows, [
    { full_name: 'Əli Əliyev' },
    { full_name: 'Nigar   Məmmədova' },
    { full_name: 'Nigar Məmmədova' }
  ]);
  assert.equal(normalizeStudentName('   NİGAR\tMəmmədova  '), normalizeStudentName('Nigar Məmmədova'));
});

test('flags normalized duplicates within the selected group context', () => {
  assert.deepEqual(duplicateStudentNameFlags(
    ['  NİGAR   Məmmədova ', 'Ali Əliyev', 'Nigar Məmmədova'],
    ['Nigar Məmmədova']
  ), [true, false, true]);
  assert.deepEqual(duplicateStudentNameFlags(['Nigar Məmmədova']), [false]);
});

test('requires a Student Name column and rejects malformed matrix rows', () => {
  assert.throws(() => mapMatrixToStudents([['Legacy ID', 'Name'], ['1', 'A']], { full_name: '-1' }), /Map Student Name/);
  assert.throws(() => mapMatrixToStudents([['Name'], null], { full_name: '0' }), /invalid row/);
});

test('maps attendance by student name and status, without identifiers', () => {
  const matrix = parseDelimitedText('Student Name\tStatus\nNigar Məmmədova\tPRESENT\nAliyev, Anar\tAbsent');
  assert.deepEqual(mapMatrixToAttendance(matrix, { full_name: '0', status: '1' }), [
    { full_name: 'Nigar Məmmədova', status: 'present' }, { full_name: 'Aliyev, Anar', status: 'absent' }
  ]);
  assert.deepEqual(parseDelimitedText('Student Name,Course,Group\nAliyev,Other,Other'), [['Student Name', 'Course', 'Group'], ['Aliyev', 'Other', 'Other']]);
});

test('round-trips tabs and quotes in editable preview text', () => {
  const input = [['Student Name', 'Status'], ['A "quoted"\tname', 'present']];
  assert.deepEqual(parseDelimitedText(rowsToTsv(input)), input);
});
