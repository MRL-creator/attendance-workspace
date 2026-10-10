import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { columnLabel, readWorkbook, workbookSheetPreview, workbookImportMatrix } from '../src/xlsx-viewer.js';

function fixtureWorkbook() {
  const workbook = XLSX.utils.book_new();
  const attendance = XLSX.utils.aoa_to_sheet([
    ['Student Name', 'Date', 'Status'],
    ['Student One', new Date(Date.UTC(2026, 9, 2)), 'Present'],
    ['Student Two', new Date(Date.UTC(2026, 9, 3)), 'Absent']
  ]);
  attendance.B2.z = 'yyyy-mm-dd';
  attendance.B3.z = 'yyyy-mm-dd';
  XLSX.utils.book_append_sheet(workbook, attendance, 'Group 1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Group'], ['Group 2']]), 'Group 2');
  return workbook;
}

test('reads a workbook and renders formatted values from multiple worksheets', () => {
  const file = XLSX.write(fixtureWorkbook(), { type: 'array', bookType: 'xlsx' });
  const workbook = readWorkbook(XLSX, file);
  assert.deepEqual(workbook.SheetNames, ['Group 1', 'Group 2']);

  const first = workbookSheetPreview(XLSX, workbook, 0);
  assert.equal(first.name, 'Group 1');
  assert.deepEqual(first.columns, ['A', 'B', 'C']);
  assert.equal(first.rows[1].cells[0].value, 'Student One');
  assert.equal(first.rows[1].cells[1].value, '2026-10-02');

  const second = workbookSheetPreview(XLSX, workbook, 1);
  assert.equal(second.name, 'Group 2');
  assert.equal(second.rows[1].cells[0].value, 'Group 2');
});

test('rejects corrupt workbooks and invalid worksheet indexes', () => {
  assert.throws(() => readWorkbook(XLSX, new Uint8Array([1, 2, 3, 4])), /valid, unencrypted Excel/);
  assert.throws(() => workbookSheetPreview(XLSX, fixtureWorkbook(), 8), /Choose a worksheet/);
});

test('converts column numbers to spreadsheet labels', () => {
  assert.equal(columnLabel(1), 'A');
  assert.equal(columnLabel(26), 'Z');
  assert.equal(columnLabel(27), 'AA');
  assert.equal(columnLabel(703), 'AAA');
});

test('imports the selected worksheet without silently truncating large row or column ranges', () => {
  const workbook=fixtureWorkbook();
  assert.deepEqual(workbookImportMatrix(XLSX,workbook,1),[['Group'],['Group 2']]);
  const sheet=workbook.Sheets['Group 1'];
  sheet['!fullref']='A1:C2002';
  assert.throws(()=>workbookImportMatrix(XLSX,workbook,0),/2,000 data rows/);
  sheet['!fullref']='A1:AY3';
  assert.throws(()=>workbookImportMatrix(XLSX,workbook,0),/50 columns/);
  sheet['!fullref']='A1:C2001';
  assert.equal(workbookImportMatrix(XLSX,workbook,0).length,3);
  assert.throws(()=>workbookImportMatrix(XLSX,workbook,99),/Choose a worksheet/);
});

test('actual encoded workbook retains full range for overflow detection', () => {
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Name'],...Array.from({length:2001},(_,i)=>[`Student ${i}`])]),'Large');
  const decoded=readWorkbook(XLSX,XLSX.write(workbook,{type:'array',bookType:'xlsx'}));
  assert.equal(workbookSheetPreview(XLSX,decoded).truncated,true);
  assert.throws(()=>workbookImportMatrix(XLSX,decoded),/2,000 data rows/);
});
