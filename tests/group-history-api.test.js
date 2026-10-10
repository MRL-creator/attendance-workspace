import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFixture} from './helpers/history-fixture.js';

test('bulk history matches individual rosters and uses a constant number of database queries',async()=>{
  const {db,fetch}=await historyFixture();
  const sessions=await(await fetch('/api/sessions?group=group')).json();
  const before=db.queries;
  const expected=await Promise.all(sessions.map(async s=>({session:s.id,roster:await(await fetch(`/api/sessions/${s.id}/attendance`)).json()})));
  const oldQueries=db.queries-before;
  const next=db.queries,response=await fetch('/api/groups/group/history');
  assert.equal(response.status,200);
  const result=await response.json(),newQueries=db.queries-next;
  const actual=new Map(result.rows.map(r=>[r.attendance_id,r]));
  for(const {session,roster} of expected)for(const row of roster)assert.deepEqual(actual.get(row.attendance_id),{...row,session_id:session});
  assert.equal(actual.size,51);
  assert.equal(result.rows.find(r=>r.student_key===null).full_name,'Former Student');
  assert.ok(newQueries<=5,`expected bounded queries, got ${newQueries}`);
  assert.ok(oldQueries>=200);
  db.sqlite.close();
});
test('bulk history enforces capabilities and group assignments and excludes archived sessions',async()=>{
  const {db,fetch}=await historyFixture(2);
  assert.equal((await fetch('/api/groups/private/history')).status,403);
  assert.equal((await fetch('/api/groups/missing/history')).status,404);
  db.sqlite.exec("UPDATE sessions SET active=0 WHERE id='session-1'");
  const result=await(await fetch('/api/groups/group/history')).json();
  assert.ok(result.rows.every(r=>r.session_id==='session-0'));
  db.sqlite.exec("DELETE FROM instructor_assignments");
  assert.equal((await fetch('/api/groups/group/history')).status,403);
  db.sqlite.exec("UPDATE user_roles SET role_code='viewer' WHERE user_id='teacher'");
  assert.equal((await fetch('/api/groups/group/history')).status,200);
  db.sqlite.exec("DELETE FROM user_roles");
  assert.equal((await fetch('/api/groups/group/history')).status,403);
  db.sqlite.close();
});

test('bulk history selects the same latest 500 sessions as the session list',async()=>{
  const {db,fetch}=await historyFixture(501);
  const sessions=await(await fetch('/api/sessions?group=group')).json();
  const result=await(await fetch('/api/groups/group/history')).json();
  const selected=new Set(sessions.map(s=>s.id));
  assert.equal(selected.size,500);
  assert.equal(new Set(result.rows.map(r=>r.session_id)).size,500);
  assert.ok(result.rows.every(r=>selected.has(r.session_id)));
  db.sqlite.close();
});

test('oversized history produces an error instead of incomplete attendance totals',async()=>{
  const {db,fetch}=await historyFixture(1);
  db.sqlite.exec(`WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<50001)
    INSERT INTO attendance(id,session_id,student_name_snapshot,status,recorded_by)
    SELECT 'large-'||x,'session-0','Synthetic Former Student','absent','teacher' FROM numbers;`);
  const response=await fetch('/api/groups/group/history');
  assert.equal(response.status,413);
  assert.match((await response.json()).error,/50,000/);
  db.sqlite.close();
});

test('report export refuses to silently cut off records at its limit',async()=>{
  const {db,fetch}=await historyFixture(1);
  assert.equal((await fetch('/api/export/attendance.json')).status,403);
  db.sqlite.exec("INSERT INTO user_permissions(user_id,permission_code,granted_by) VALUES('teacher','reports.export','teacher')");
  db.sqlite.exec(`WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<20000)
    INSERT INTO attendance(id,session_id,student_name_snapshot,status,recorded_by)
    SELECT 'export-'||x,'session-0','Synthetic Former Student','absent','teacher' FROM numbers;`);
  const response=await fetch('/api/export/attendance.json');
  assert.equal(response.status,413);
  assert.match((await response.json()).error,/20,000/);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE action='exported'").get().n,0);
  db.sqlite.close();
});
