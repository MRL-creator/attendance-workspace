import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { database } from './helpers/database.js';

const key = 'a-test-only-bootstrap-key-at-least-32-characters';
const owner = { workspace_name: 'Community Classes', name: 'Alex Teacher', email: 'alex@example.org', password: 'a-long-test-password' };
export function request(db, path, { method = 'GET', data, cookie, env = {}, headers = {} } = {}) {
  return worker.fetch(new Request(`https://example.test${path}`, { method, headers: { ...headers, ...(cookie ? {cookie} : {}), ...(data ? {'content-type':'application/json'} : {}) }, ...(data ? {body:JSON.stringify(data)} : {}) }), { DB:db, BOOTSTRAP_KEY:key, ...env }, {});
}
const setup = (db, data = owner, options = {}) => request(db, '/api/setup', { method:'POST', data, headers:{'x-bootstrap-key':key}, ...options });
export async function signedIn(db) {
  assert.equal((await setup(db)).status, 201);
  const response = await request(db, '/api/auth/login', {method:'POST', data:owner});
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
test('fresh installation creates one chosen owner, accepts ordinary email, and names the workspace', async () => {
  const db = database();
  assert.deepEqual(await (await request(db, '/api/workspace')).json(), {name:'Attendance Workspace',setupRequired:true});
  const cookie = await signedIn(db);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.notEqual(db.sqlite.prepare('SELECT password_hash FROM users').get().password_hash, owner.password);
  const {user} = await (await request(db, '/api/me', {cookie})).json();
  assert.equal(user.is_super_admin, true);
  assert.equal(user.must_change_password, false);
  assert.ok(user.roles.includes('instructor'));
  assert.deepEqual(await (await request(db, '/api/workspace')).json(), {name:owner.workspace_name,setupRequired:false});
  assert.equal((await setup(db)).status, 409);
  assert.equal((await request(db, '/api/workspace', {method:'PUT',cookie,data:{name:'Renamed Workspace'}})).status, 200);
  assert.equal((await request(db, '/api/workspace', {method:'PUT',data:{name:'Unauthorized'}})).status, 401);
  db.sqlite.close();
});
test('bootstrap validates secret, email, password, optional domain policy and origin', async () => {
  const db=database();
  assert.equal((await setup(db, owner, {headers:{}})).status, 403);
  assert.equal((await setup(db, owner, {env:{BOOTSTRAP_KEY:'short'},headers:{'x-bootstrap-key':'short'}})).status, 403);
  for(const data of [{...owner,email:'bad'}, {...owner,password:'short'}, {...owner,workspace_name:''}]) assert.equal((await setup(db,data)).status,400);
  assert.equal((await setup(db,owner,{env:{ALLOWED_EMAIL_DOMAINS:'school.example'}})).status,400);
  assert.equal((await setup(db,owner,{headers:{'x-bootstrap-key':key,origin:'https://attacker.test'}})).status,403);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM users').get().n,0);
  assert.equal((await setup(db,owner,{env:{ALLOWED_EMAIL_DOMAINS:'EXAMPLE.ORG, school.example'}})).status,201);
  db.sqlite.close();
});
test('concurrent bootstrap attempts create exactly one owner and one workspace', async () => {
  const db=database();
  const results=await Promise.all([setup(db),setup(db,{...owner,email:'other@example.org'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM workspace_settings').get().n,1);
  db.sqlite.close();
});
test('bootstrap rolls back completely if any statement fails', async t => {
  t.mock.method(console,'error',()=>{});
  const db=database();
  db.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  assert.equal((await setup(db)).status,500);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM users').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM workspace_settings').get().n,0);
  db.sqlite.close();
});
test('owner protection uses roles instead of a special email, staff can use any valid domain', async () => {
  const db=database(),cookie=await signedIn(db);
  const uid=db.sqlite.prepare('SELECT id FROM users').get().id;
  assert.equal((await request(db,`/api/users/${uid}/roles`,{method:'PUT',cookie,data:{roles:['admin']}})).status,409);
  const result=await request(db,'/api/users',{method:'POST',cookie,data:{name:'Jordan Trainer',email:'jordan@personal.example',roles:['instructor']}});
  assert.equal(result.status,201);
  const staff=await result.json();
  assert.equal((await request(db,`/api/users/${staff.id}/roles`,{method:'PUT',cookie,data:{roles:['super_admin']}})).status,403);
  db.sqlite.close();
});
