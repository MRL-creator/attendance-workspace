import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../public/csv.js';

test('parses quoted names and ignores uploaded Course, Group, and unrelated columns', () => {
  const rows = parseCSV('\ufeffStudent Name,Course,Group,Legacy ID\r\n"Əliyeva, Şəbnəm",Untrusted,Group 1,001\r\n"A ""quote""",Other,Group 2,002');
  assert.deepEqual(rows, [
    { full_name: 'Əliyeva, Şəbnəm' },
    { full_name: 'A "quote"' }
  ]);
});

test('recognizes Full Name and Name headers in semicolon-delimited files', () => {
  assert.deepEqual(parseCSV('ID;Full Name;Class\nA-1;Nigar Məmmədova;Group 3'), [
    { full_name: 'Nigar Məmmədova' }
  ]);
  assert.deepEqual(parseCSV('Name;Group\nAli Əliyev;Group 2'), [{ full_name: 'Ali Əliyev' }]);
});

test('rejects malformed CSV and inputs without a student name column', () => {
  assert.throws(() => parseCSV('Student Name\n"unfinished'), /unfinished quoted field/);
  assert.throws(() => parseCSV('Student Name\n"closed"tail'), /unexpected characters/);
  assert.throws(() => parseCSV('Student Name\nun"finished'), /quote inside an unquoted field/);
  assert.throws(() => parseCSV('Legacy ID,Group\n1,Group 1'), /Student Name column/);
  assert.throws(() => parseCSV('Student Name'), /header row and at least one student/);
});

test('detects delimiters outside quoted headers and supports CR-only line endings', () => {
  assert.deepEqual(parseCSV('Student Name;Course;Group\r"Məmmədova; Nigar";Other;Group 2'), [
    { full_name: 'Məmmədova; Nigar' }
  ]);
});
