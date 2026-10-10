export const ATTENDANCE_EXPORT_COLUMNS = [
  ['Student name', 'student'],
  ['Course', 'course'],
  ['Group', 'group_name'],
  ['Date', 'session_date'],
  ['Start time', 'start_time'],
  ['End time', 'end_time'],
  ['Room', 'room'],
  ['Status', 'status'],
  ['Instructor', 'instructor']
];

export function buildConsolidatedAttendanceSheets(rows) {
  const sessions = new Map();
  const students = new Map();
  const marks = new Map();
  for (const row of rows) {
    if (!sessions.has(row.session_id)) sessions.set(row.session_id, row);
    const studentKey = `${row.course}\u0000${row.group_name}\u0000${row.student}`;
    if (!students.has(studentKey)) students.set(studentKey, { student: row.student, course: row.course, group_name: row.group_name, marks: new Map() });
    students.get(studentKey).marks.set(row.session_id, row.status);
    const aggregate = marks.get(row.session_id) || { count: 0, present: 0, absent: 0 };
    aggregate.count++;
    aggregate[row.status]++;
    marks.set(row.session_id, aggregate);
  }
  const orderedSessions = [...sessions.entries()].sort(([, a], [, b]) => `${a.session_date} ${a.start_time || ''}`.localeCompare(`${b.session_date} ${b.start_time || ''}`));
  const sessionLabel = row => [row.session_date, row.group_name, row.start_time].filter(Boolean).join(' · ');
  const attendance = [
    ['Student name', 'Course', 'Group', ...orderedSessions.map(([, row]) => sessionLabel(row)), 'Absent', 'Attendance %'],
    ...[...students.values()].sort((a, b) => `${a.course} ${a.group_name} ${a.student}`.localeCompare(`${b.course} ${b.group_name} ${b.student}`, undefined, { sensitivity: 'base' })).map(student => {
      const statuses = [...student.marks.values()], present = statuses.filter(status => status === 'present').length;
      return [student.student, student.course, student.group_name, ...orderedSessions.map(([sessionId]) => student.marks.get(sessionId) || ''), statuses.filter(status => status === 'absent').length, statuses.length ? Math.round(100 * present / statuses.length) : ''];
    })
  ];
  const studentRows = [
    ['Student name', 'Course', 'Group', 'Sessions attended', 'Sessions absent', 'Attendance %'],
    ...[...students.values()].map(student => {
      const statuses = [...student.marks.values()], present = statuses.filter(status => status === 'present').length;
      return [student.student, student.course, student.group_name, present, statuses.filter(status => status === 'absent').length, statuses.length ? Math.round(100 * present / statuses.length) : ''];
    })
  ];
  const sessionSummary = [
    ['Date', 'Course', 'Group', 'Start time', 'End time', 'Room', 'Instructor', 'Students', 'Present', 'Absent', 'Attendance %'],
    ...orderedSessions.map(([sessionId, row]) => {
      const counts = marks.get(sessionId), percentage = counts.count ? Math.round(100 * counts.present / counts.count) : 0;
      return [row.session_date, row.course, row.group_name, row.start_time || '', row.end_time || '', row.room || '', row.instructor, counts.count, counts.present, counts.absent, percentage];
    })
  ];
  return { Attendance: attendance, Students: studentRows, 'Session Summary': sessionSummary };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function attendanceCsvText(rows) {
  return [
    ATTENDANCE_EXPORT_COLUMNS.map(([label]) => csvCell(label)).join(','),
    ...rows.map(row => ATTENDANCE_EXPORT_COLUMNS.map(([, key]) => csvCell(row[key])).join(','))
  ].join('\r\n');
}
