import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfTextItemsToRows } from '../src/pdf-utils.js';

const item = (str, x, y, width = 20) => ({ str, width, transform: [1, 0, 0, 1, x, y] });

test('reconstructs ordered table rows from positioned PDF text', () => {
  const rows = pdfTextItemsToRows([
    item('Group 1', 180, 700, 50), item('Student Name', 10, 700, 75),
    item('Nigar Məmmədova', 10, 680, 75), item('Group 1', 180, 680, 50)
  ]);
  assert.deepEqual(rows, [
    ['Student Name', 'Group 1'],
    ['Nigar Məmmədova', 'Group 1']
  ]);
});

test('ignores non-positioned and empty PDF text items', () => {
  assert.deepEqual(pdfTextItemsToRows([{ str: 'x' }, item(' ', 5, 5), item('value', 20, 5)]), [['value']]);
});
