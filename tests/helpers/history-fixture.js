import worker from '../../src/index.js';
import { database } from './database.js';

export async function historyFixture(count=50) {
  const db=database();
  const token='history-test-token';
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  db.sqlite.exec(`
    INSERT INTO users(id,email,full_name,password_hash,role) VALUES('teacher','teacher@example.org','Test Teacher','unused','instructor');
    INSERT INTO user_roles(user_id,role_code) VALUES('teacher','instructor');
    INSERT INTO courses(id,name) VALUES('course','Community Course');
    INSERT INTO groups(id,name,course_id) VALUES('group','Morning Group','course'),('private','Another Group','course');
    INSERT INTO instructor_assignments(id,instructor_id,course_id,group_id) VALUES('assignment','teacher','course','group');
    INSERT INTO students(id,full_name,group_id) VALUES('student','Taylor Student','group');
  `);
  db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,'teacher',Math.floor(Date.now()/1000)+3600);
  for(let index=0;index<count;index++){
    db.sqlite.prepare("INSERT INTO sessions(id,course_id,group_id,instructor_id,session_date) VALUES(?,'course','group','teacher',?)").run(`session-${index}`,`2026-09-${String(index%28+1).padStart(2,'0')}`);
    db.sqlite.prepare("INSERT INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by) VALUES(?,?,'student','Taylor Student',?,'teacher')").run(`mark-${index}`,`session-${index}`,index%2?'present':'absent');
  }
  // Snapshot of a removed student: history must remain visible after deletion.
  db.sqlite.prepare("INSERT INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by) VALUES('historical','session-0',NULL,'Former Student','present','teacher')").run();
  const fetch=path=>worker.fetch(new Request(`https://example.test${path}`,{headers:{cookie:`attendance_session=${token}`}}),{DB:db},{});
  return {db,fetch};
}
