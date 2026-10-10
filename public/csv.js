export function parseCSVMatrix(text) {
  text = text.replace(/^\ufeff/, '');
  if (text.length > 2_000_000) throw new Error('The file is too large. Choose a CSV under 2 MB.');
  text = text.replace(/\r\n?/g, '\n');
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inHeaderQuote = false;
  for (let i = 0; i < text.length && text[i] !== '\n'; i++) {
    if (text[i] === '"' && text[i + 1] === '"' && inHeaderQuote) { i++; continue; }
    if (text[i] === '"') inHeaderQuote = !inHeaderQuote;
    else if (!inHeaderQuote && Object.hasOwn(counts, text[i])) counts[text[i]]++;
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote && char !== delimiter && char !== '\n') throw new Error('This CSV has unexpected characters after a quoted field.');
    else if (char === '"') { if (cell) throw new Error('This CSV has a quote inside an unquoted field.'); quoted = true; }
    else if (char === delimiter) { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n') { row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; closedQuote = false; }
    else cell += char;
  }
  if (quoted) throw new Error('This CSV contains an unfinished quoted field.');
  if (cell || row.length || closedQuote) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error('The file needs a header row and at least one student or attendance data row.');
  if (rows.length > 2001) throw new Error('The import is limited to 2,000 data rows.');
  if (Math.max(...rows.map(values => values.length)) > 50) throw new Error('The file is limited to 50 columns.');
  return rows;
}

export function parseCSV(text) {
  const rows = parseCSVMatrix(text);
  const headers = rows.shift().map(value => value.trim().toLocaleLowerCase());
  const find = terms => headers.findIndex(header => terms.some(term => header === term || header.includes(term)));
  const index = find(['student name', 'full name', 'fullname', 'name']);
  if (index < 0) throw new Error('A Student Name column is required.');
  return rows.map(values => ({ full_name: values[index] || '' }));
}
