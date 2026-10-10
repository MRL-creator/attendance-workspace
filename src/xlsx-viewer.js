export const MAX_WORKBOOK_ROWS = 2000;
export const MAX_WORKBOOK_COLUMNS = 50;

const INVALID_WORKBOOK = 'This workbook could not be opened. Choose a valid, unencrypted Excel .xlsx file.';

export function readWorkbook(XLSX, data) {
  let workbook;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]);
    const isOle = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
    if (!isZip && !isOle) throw new Error(INVALID_WORKBOOK);
    workbook = XLSX.read(data, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      cellStyles: true,
      cellFormula: false,
      bookVBA: false,
      sheetRows: MAX_WORKBOOK_ROWS + 1
    });
  } catch {
    throw new Error(INVALID_WORKBOOK);
  }
  if (!Array.isArray(workbook?.SheetNames) || !workbook.SheetNames.length || !workbook.Sheets) {
    throw new Error(INVALID_WORKBOOK);
  }
  return workbook;
}

export function workbookImportMatrix(XLSX, workbook, sheetIndex = 0) {
  const name=workbook?.SheetNames?.[sheetIndex],sheet=workbook?.Sheets?.[name];
  if(!sheet)throw new Error('Choose a worksheet to import.');
  const ref=sheet['!fullref']||sheet['!ref'];
  if(!ref)return [];
  const range=XLSX.utils.decode_range(ref);
  if(range.e.r-range.s.r+1>MAX_WORKBOOK_ROWS+1)throw new Error('Import supports at most 2,000 data rows plus a header. Split this worksheet before importing; nothing was imported.');
  if(range.e.c-range.s.c+1>MAX_WORKBOOK_COLUMNS)throw new Error('Import supports at most 50 columns. Remove unused columns before importing; nothing was imported.');
  return XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false});
}

function formatCell(XLSX, cell) {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  try {
    return String(cell.w ?? XLSX.utils.format_cell(cell) ?? cell.v);
  } catch {
    return String(cell.v);
  }
}

function cellPresentation(cell) {
  const style = cell?.s || {};
  const alignment = ['left', 'center', 'right'].includes(style.alignment?.horizontal)
    ? style.alignment.horizontal
    : '';
  return {
    bold: Boolean(style.font?.bold),
    italic: Boolean(style.font?.italic),
    alignment
  };
}

export function columnLabel(oneBasedColumn) {
  let column = oneBasedColumn;
  let label = '';
  while (column > 0) {
    const remainder = (column - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    column = Math.floor((column - 1) / 26);
  }
  return label;
}

export function workbookSheetPreview(XLSX, workbook, sheetIndex = 0) {
  const name = workbook?.SheetNames?.[sheetIndex];
  if (typeof name !== 'string' || !name) throw new Error('Choose a worksheet to preview.');
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error('This worksheet could not be opened.');
  if (!sheet['!ref']) return { name, rows: [], columns: [], truncated: false, empty: true };

  let range, fullRange;
  try {
    range = XLSX.utils.decode_range(sheet['!ref']);
    fullRange = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : range;
  } catch {
    throw new Error('This worksheet has an invalid cell range.');
  }
  if (!range || range.e.r < range.s.r || range.e.c < range.s.c) {
    return { name, rows: [], columns: [], truncated: false, empty: true };
  }

  const rowCount = Math.min(range.e.r - range.s.r + 1, MAX_WORKBOOK_ROWS);
  const columnCount = Math.min(range.e.c - range.s.c + 1, MAX_WORKBOOK_COLUMNS);
  const rows = [];
  for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
    const rowNumber = range.s.r + rowOffset + 1;
    const cells = [];
    for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
      const columnNumber = range.s.c + columnOffset + 1;
      const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: columnNumber - 1 });
      const cell = sheet[address];
      cells.push({ value: formatCell(XLSX, cell), style: cellPresentation(cell) });
    }
    rows.push({ number: rowNumber, cells, searchText: cells.map(cell => cell.value).join(' ').toLocaleLowerCase() });
  }

  return {
    name,
    rows,
    columns: Array.from({ length: columnCount }, (_, index) => columnLabel(range.s.c + index + 1)),
    truncated: Math.max(range.e.r, fullRange.e.r) - range.s.r + 1 > rowCount || Math.max(range.e.c, fullRange.e.c) - range.s.c + 1 > columnCount,
    empty: rows.every(row => row.cells.every(cell => !cell.value))
  };
}
