import assert from 'node:assert/strict';
import { historyFixture } from '../tests/helpers/history-fixture.js';

const {db,fetch}=await historyFixture(100);
const sessions=await(await fetch('/api/sessions?group=group')).json();
let start=performance.now(),before=db.queries;
const rosters=await Promise.all(sessions.map(async session=>{
  const response=await fetch(`/api/sessions/${session.id}/attendance`);
  assert.equal(response.status,200);return response.json();
}));
const individual={httpRequests:sessions.length,sqlQueries:db.queries-before,ms:Math.round((performance.now()-start)*100)/100};
start=performance.now();before=db.queries;
const response=await fetch('/api/groups/group/history');assert.equal(response.status,200);
const {rows}=await response.json();
const bulk={httpRequests:1,sqlQueries:db.queries-before,ms:Math.round((performance.now()-start)*100)/100};
assert.equal(rows.length,rosters.flat().length);
console.log(JSON.stringify({sessions:sessions.length,marks:rows.length,individual,bulk,note:'Local in-memory SQLite, no network latency. Query/request counts are the reliable comparison.'},null,2));
db.sqlite.close();
