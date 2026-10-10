export const STUDENT_IMPORT_FIELDS = ['full_name'];
export const ATTENDANCE_IMPORT_FIELDS = ['full_name', 'status'];

const studentNameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function normalizeStudentName(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase().replace(/\u0307/gu, '');
}

export function duplicateStudentNameFlags(names, existingNames = []) {
  const existing = new Set(existingNames.map(normalizeStudentName).filter(Boolean));
  const seen = new Set();
  return names.map(name => {
    const key = normalizeStudentName(name), duplicate = Boolean(key && (existing.has(key) || seen.has(key)));
    if (key) seen.add(key);
    return duplicate;
  });
}

export function sortStudentsByName(students) {
  return [...students].sort((a, b) => studentNameCollator.compare(a.full_name, b.full_name));
}

function validateMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) throw new Error('The file needs a header row and at least one data row.');
  if (matrix.length > 2001) throw new Error('The import is limited to 2,000 data rows.');
  if (matrix.slice(0, 2001).some(row => !Array.isArray(row))) throw new Error('The file contains an invalid row.');
  const width = Math.max(...matrix.slice(0, 2001).map(row => row.length));
  if (!width || width > 50) throw new Error('The file must contain between 1 and 50 columns.');
  return width;
}

export function mapMatrixToStudents(matrix, mapping) {
  const width = validateMatrix(matrix), index = Number(mapping?.full_name);
  if (!Number.isInteger(index) || index < 0 || index >= width) {
    throw new Error('Map Student Name to a source column before continuing.');
  }
  return sortStudentsByName(matrix.slice(1).filter(row => row.some(value => String(value ?? '').trim())).map(row => ({
    full_name: String(row[index] ?? '').trim()
  })));
}

export function mapMatrixToAttendance(matrix, mapping) {
  const width = validateMatrix(matrix), indexes = ATTENDANCE_IMPORT_FIELDS.map(field => Number(mapping?.[field]));
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= width) || new Set(indexes).size !== indexes.length) {
    throw new Error('Map Student Name and Attendance status to separate columns before continuing.');
  }
  return matrix.slice(1).filter(row => row.some(value => String(value ?? '').trim())).map(row => ({
    full_name: String(row[indexes[0]] ?? '').trim(),
    status: String(row[indexes[1]] ?? '').trim().toLocaleLowerCase()
  }));
}

export function parseDelimitedText(text) {
  const input = String(text ?? '');
  if (input.length > 2_000_000) throw new Error('The file is too large. Choose a file under 2 MB.');
  const first = input.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] || '', delimiter = ['\t', ',', ';', '|'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) { if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quoted) throw new Error('The extracted text contains an unfinished quoted field.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push(row); }
  return rows;
}

export function rowsToTsv(rows) {
  return rows.map(row => row.map(value => { const text = String(value ?? ''); return /["\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join('\t')).join('\n');
}
