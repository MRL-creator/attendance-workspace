export function buildStudentAttendanceHistory(students, sessions, rosters) {
  const byStudent = new Map(students.map(student => [student.id, { ...student, marks: new Map() }]));
  for (let index = 0; index < sessions.length; index++) {
    for (const record of rosters[index] || []) {
      const studentKey = record.student_key || `historical:${record.attendance_id}`;
      if (!byStudent.has(studentKey)) {
        byStudent.set(studentKey, {
          id: studentKey,
          full_name: record.full_name,
          active: record.active ?? 0,
          marks: new Map()
        });
      }
      byStudent.get(studentKey).marks.set(sessions[index].id, record.status);
    }
  }
  return [...byStudent.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }));
}

export function summarizeAttendanceHistory(students) {
  const statuses = students.flatMap(student => [...student.marks.values()]);
  const present = statuses.filter(status => status === 'present').length;
  return {
    present,
    absent: statuses.length - present,
    total: statuses.length,
    percentage: statuses.length ? Math.round(present * 100 / statuses.length) : 0
  };
}

export function studentAbsenceDates(student, sessions, formatDate) {
  return sessions.filter(session => student.marks.get(session.id) === 'absent').map(session => formatDate(session.session_date));
}
