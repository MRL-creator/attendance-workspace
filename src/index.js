import {validAccountEmail} from './workspace-utils.js';
import {can, hasRole, isAdmin, isViewer} from './policy.js';
import {duplicateStudentNameFlags, normalizeStudentName, sortStudentsByName} from './import-utils.js';
import {attendanceCsvText} from './report-utils.js';
import {canAssignSessionInstructor} from './session-utils.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const cookieName = 'attendance_session';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${b64(salt)}:${b64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = await hashPassword(password, unb64(salt));
  return actual === stored && expected.length > 0;
}
async function body(req) { try { const declared=Number(req.headers.get('content-length')||0);if(declared>2_000_000)return null;const text=await req.text();if(new TextEncoder().encode(text).byteLength>2_000_000)return null;return JSON.parse(text); } catch { return null; } }
function cookies(req) { return Object.fromEntries((req.headers.get('cookie') || '').split(';').map(s => s.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2)); }
function cookie(value, maxAge) { return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function publicUser(row) {
  if (!row) return null;
  const roles = row.roles ? row.roles.split(',') : [row.role];
  const permissions = row.permissions ? row.permissions.split(',').filter(Boolean) : [];
  return { id:row.id,email:row.email,name:row.full_name,role:roles.includes('admin')||roles.includes('super_admin')?'admin':roles.includes('viewer')?'viewer':'instructor',roles,permissions,is_super_admin:roles.includes('super_admin'),must_change_password:Boolean(row.must_change_password),theme:['light','dark','system'].includes(row.theme)?row.theme:'system' };
}
async function audit(db, actor, action, type, entity, details = {}) {
  await db.prepare('INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?,?)').bind(id(), actor?.id || null, action, type, entity || null, JSON.stringify(redactSensitive(details))).run();
}
async function createBackup(db, actor, resourceType, resourceId, data) {
  const snapshot=JSON.stringify(data);if(new TextEncoder().encode(snapshot).byteLength>1_800_000)throw new Error('This change is too large to snapshot at once. Select fewer records.');
  const backupId=id(),recordCount=Array.isArray(data)?data.length:(data?.students?.length||data?.attendance?.length||(data?.session||data?.id?1:0));
  await db.prepare('INSERT INTO backups(id,resource_type,resource_id,created_by,record_count,data_json) VALUES(?,?,?,?,?,?)').bind(backupId,resourceType,resourceId||null,actor.id,recordCount,snapshot).run();
  await audit(db,actor,'created','backup',backupId,{resource_type:resourceType,record_count:recordCount});return backupId;
}
function redactSensitive(value){if(Array.isArray(value))return value.map(redactSensitive);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(password|hash|secret|token|credential|api[_-]?key|client[_-]?secret)/i.test(key)).map(([key,item])=>[key,redactSensitive(item)]));return value;}
function safeAuditDetails(raw){try{return JSON.stringify(redactSensitive(JSON.parse(raw||'{}')));}catch{return '{}';}}
async function getUser(req, env) {
  const token = cookies(req)[cookieName];
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.email,u.full_name,u.role,u.active,u.must_change_password,s.expires_at,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles,COALESCE((SELECT group_concat(DISTINCT rp.permission_code) FROM user_roles ur JOIN role_permissions rp ON rp.role_code=ur.role_code WHERE ur.user_id=u.id),'')||','||COALESCE((SELECT group_concat(permission_code) FROM user_permissions WHERE user_id=u.id),'') permissions,(SELECT theme FROM user_preferences WHERE user_id=u.id) theme FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).bind(await digest(token)).first();
  if (!row || !row.active || row.expires_at < now()) return null;
  return publicUser(row);
}
async function getUserById(db,userId) {
  const row=await db.prepare(`SELECT u.id,u.email,u.full_name,u.role,u.active,u.must_change_password,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles,COALESCE((SELECT group_concat(DISTINCT rp.permission_code) FROM user_roles ur JOIN role_permissions rp ON rp.role_code=ur.role_code WHERE ur.user_id=u.id),'')||','||COALESCE((SELECT group_concat(permission_code) FROM user_permissions WHERE user_id=u.id),'') permissions,(SELECT theme FROM user_preferences WHERE user_id=u.id) theme FROM users u WHERE u.id=?`).bind(userId).first();
  return row?.active?publicUser(row):null;
}
function requireAdmin(user) { return can(user,'settings.manage') ? null : fail('Administrator access is required.', 403); }
function requireCapability(user,permission) { return can(user,permission) ? null : fail('You do not have permission to perform this action.',403); }
async function assigned(db, user, courseId, groupId) {
  if (isAdmin(user)) return true;
  return !!await db.prepare('SELECT 1 FROM instructor_assignments WHERE instructor_id=? AND course_id=? AND group_id=?').bind(user.id, courseId, groupId).first();
}
async function sessionAccess(db, user, sessionId, write=false) {
  const s = await db.prepare('SELECT * FROM sessions WHERE id=?').bind(sessionId).first();
  if (!s) return { error: fail('Session not found.', 404) };
  if(write&&!s.active)return { error:fail('This session is archived and can no longer be changed.',409) };
  if (write && !can(user,'attendance.update')) return { error:fail('You do not have permission to change attendance.',403) };
  if (!write && !can(user,'attendance.read')) return { error:fail('You do not have permission to view attendance.',403) };
  if (!isAdmin(user) && !isViewer(user) && (!(await assigned(db,user,s.course_id,s.group_id) || s.instructor_id===user.id))) return { error: fail('You do not have access to this session.', 403) };
  if (write && !isAdmin(user) && s.instructor_id !== user.id) return { error:fail('You can change attendance only for your own sessions.',403) };
  return { session: s };
}
function cleanText(value, max = 180) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
function validTime(value) { return typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function addMinutesToTime(value,minutes) { const [h,m]=value.split(':').map(Number),n=h*60+m+minutes;return n>=1440?'':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
async function attendanceRows(db,user,searchParams,{limit=500,offset=0}={}) {
  const filters={from:searchParams.get('from')||'',to:searchParams.get('to')||'',course:searchParams.get('course')||'',group:searchParams.get('group')||'',instructor:searchParams.get('instructor')||'',status:searchParams.get('status')||'',entity_status:searchParams.get('entity_status')||'active',session_status:searchParams.get('session_status')||'active',room:cleanText(searchParams.get('room'),80),q:cleanText(searchParams.get('q'),100)};
  if(filters.from&&!validDate(filters.from)||filters.to&&!validDate(filters.to))throw new Error('Choose valid start and end dates.');
  if(filters.status&&!['present','absent'].includes(filters.status))throw new Error('Choose Present or Absent for the attendance filter.');
  if(!['active','archived','all'].includes(filters.entity_status)||!['active','archived','all'].includes(filters.session_status))throw new Error('Choose Active, Archived, or All for report status.');
  const where=['1=1'],params=[];
  if(filters.session_status!=='all'){where.push('s.active=?');params.push(filters.session_status==='active'?1:0);}
  if(filters.entity_status==='active')where.push('c.active=1 AND g.active=1');
  if(filters.entity_status==='archived')where.push('(c.active=0 OR g.active=0)');
  for(const [key,column] of [['from','s.session_date>=?'],['to','s.session_date<=?'],['course','s.course_id=?'],['group','s.group_id=?'],['instructor','s.instructor_id=?']])if(filters[key]){where.push(column);params.push(filters[key]);}
  if(filters.status){where.push('a.status=?');params.push(filters.status);}
  if(filters.room){where.push('s.room LIKE ?');params.push(`%${filters.room}%`);}
  if(filters.q){where.push('st.full_name LIKE ?');params.push(`%${filters.q}%`);}
  if(!isAdmin(user)&&!isViewer(user)){where.push('(s.instructor_id=? OR EXISTS(SELECT 1 FROM instructor_assignments z WHERE z.instructor_id=? AND z.course_id=s.course_id AND z.group_id=s.group_id))');params.push(user.id,user.id);}
  const sql=`SELECT a.id attendance_id,COALESCE(NULLIF(a.student_name_snapshot,''),st.full_name) student,c.name course,g.name group_name,s.course_id,s.group_id,s.session_date,s.start_time,s.end_time,s.room,s.id session_id,s.active session_active,c.active course_active,g.active group_active,a.status,u.full_name instructor FROM attendance a LEFT JOIN students st ON st.id=a.student_key JOIN sessions s ON s.id=a.session_id JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id WHERE ${where.join(' AND ')} ORDER BY s.session_date DESC,s.start_time DESC,c.name,g.name,student,a.id LIMIT ? OFFSET ?`;
  const result=await db.prepare(sql).bind(...params,Math.min(1000,Math.max(1,limit)),Math.max(0,offset)).all();
  return {rows:result.results||[],filters};
}
async function safeRoute(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname, method = req.method;
  const db = env.DB;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return fail('Request origin could not be verified.',403);
  }
  if (method === 'GET' && path === '/api/health') return json({ ok: true });
  if (method === 'GET' && path === '/api/workspace') {
    const workspace=await db.prepare('SELECT name FROM workspace_settings WHERE id=1').first();
    return json({name:workspace?.name||'Attendance Workspace',setupRequired:!workspace});
  }
  if (method === 'POST' && path === '/api/setup') {
    if (!env.BOOTSTRAP_KEY || env.BOOTSTRAP_KEY.length<32 || req.headers.get('x-bootstrap-key')!==env.BOOTSTRAP_KEY) return fail('Setup key is invalid or is not configured with at least 32 characters.',403);
    if (await db.prepare('SELECT 1 FROM users LIMIT 1').first()) return fail('Initial setup has already been completed.',409);
    const input=await body(req),name=cleanText(input?.name,150),workspaceName=cleanText(input?.workspace_name,100),email=cleanText(input?.email,254).toLowerCase(),password=input?.password;
    if(!name||!workspaceName||!validAccountEmail(email,env.ALLOWED_EMAIL_DOMAINS)||typeof password!=='string'||password.length<12||password.length>256) return fail('Provide a workspace name, your name, a permitted email address, and a password between 12 and 256 characters.');
    const uid=id(),passwordHash=await hashPassword(password);
    try {
      // The singleton insert and account creation share one transaction. A racing
      // installer loses the unique-key check and cannot create another owner.
      await db.batch([
        db.prepare('INSERT INTO workspace_settings(id,name) VALUES(1,?)').bind(workspaceName),
        db.prepare("INSERT INTO users(id,email,full_name,password_hash,role,must_change_password) VALUES(?,?,?,?,'admin',0)").bind(uid,email,name,passwordHash),
        db.prepare("INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,'super_admin',?)").bind(uid,uid),
        db.prepare("INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,'instructor',?)").bind(uid,uid),
        db.prepare("INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES(?,?,'created','workspace','1',?)").bind(id(),uid,JSON.stringify({name:workspaceName,source:'initial setup'}))
      ]);
    } catch(error) {
      if(await db.prepare('SELECT 1 FROM workspace_settings WHERE id=1').first()) return fail('Initial setup has already been completed.',409);
      throw error;
    }
    return json({created:true,name:workspaceName},201);
  }
  if (method === 'POST' && path === '/api/auth/login') {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown', attemptKey = await digest(ip);
    let attempt = await db.prepare('SELECT attempts,window_started FROM login_attempts WHERE key=?').bind(attemptKey).first();
    if (attempt && attempt.window_started > now() - 900 && attempt.attempts >= 8) return fail('Too many sign-in attempts. Please try again in 15 minutes.',429);
    if (attempt && attempt.window_started <= now() - 900) { await db.prepare('DELETE FROM login_attempts WHERE key=?').bind(attemptKey).run(); attempt = null; }
    const input = await body(req), email = cleanText(input?.email,254).toLowerCase(),password=typeof input?.password==='string'?input.password:'';
    const user = await db.prepare(`SELECT u.*,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles,COALESCE((SELECT group_concat(DISTINCT rp.permission_code) FROM user_roles ur JOIN role_permissions rp ON rp.role_code=ur.role_code WHERE ur.user_id=u.id),'')||','||COALESCE((SELECT group_concat(permission_code) FROM user_permissions WHERE user_id=u.id),'') permissions FROM users u WHERE email=? AND active=1`).bind(email).first();
    const valid = user&&password.length<=256 ? await verifyPassword(password,user.password_hash) : false;
    if (!valid) {
      await db.prepare(`INSERT INTO login_attempts(key,attempts,window_started) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1`).bind(attemptKey,now()).run();
      return fail('Email or password is incorrect.',401);
    }
    await db.prepare('DELETE FROM login_attempts WHERE key=?').bind(attemptKey).run();
    const token = b64(crypto.getRandomValues(new Uint8Array(32))), expiry = now() + 28800;
    await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),user.id,expiry).run();
    await audit(db,user,'signed in','auth_session',user.id);
    return json({ user:publicUser(user) },200,{ 'set-cookie':cookie(token,28800) });
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    const token = cookies(req)[cookieName];
    if (token) {
      const session=await db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).first();
      if(session){const actor=await getUserById(db,session.user_id);if(actor)await audit(db,actor,'signed out','auth_session',session.user_id);}
      await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();
    }
    return json({ ok:true },200,{ 'set-cookie':cookie('',0) });
  }
  if(method==='POST'&&path==='/api/auth/change-password'){
    const user=await getUser(req,env);if(!user)return fail('Please sign in to continue.',401);
    const input=await body(req),oldPassword=typeof input?.current_password==='string'?input.current_password:'',newPassword=typeof input?.new_password==='string'?input.new_password:'';
    if(newPassword.length<12||newPassword.length>256)return fail('Choose a password between 12 and 256 characters.');
    const stored=await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.id).first();
    if(!stored||!await verifyPassword(oldPassword,stored.password_hash))return fail('Current password is incorrect.',401);
    if(oldPassword===newPassword)return fail('Choose a new password different from your current one.');
    await db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashPassword(newPassword),user.id).run();
    await audit(db,user,'changed password','user',user.id);
    return json({user:await getUserById(db,user.id)});
  }
  if (method === 'GET' && path === '/api/me') { const user = await getUser(req,env); return user ? json({user}) : fail('Please sign in to continue.',401); }
  const user = await getUser(req,env);
  if (!user) return fail('Please sign in to continue.',401);
  if(user.must_change_password)return fail('Change your temporary password before using the workspace.',403);
  if(method==='PUT'&&path==='/api/workspace'){
    if(requireAdmin(user))return requireAdmin(user);
    const input=await body(req),name=cleanText(input?.name,100);
    if(!name)return fail('Provide a workspace name of up to 100 characters.');
    await db.prepare('UPDATE workspace_settings SET name=? WHERE id=1').bind(name).run();
    await audit(db,user,'renamed','workspace','1',{name});return json({name});
  }

  if(method==='GET'&&path==='/api/search'){
    const query=cleanText(url.searchParams.get('q'),100);if(query.length<2)return json([]);const pattern=`%${query}%`,unrestricted=isAdmin(user)||isViewer(user),items=[];
    const [students,groups,courses,sessions,instructors]=await Promise.all([
      can(user,'students.read')?db.prepare(`SELECT st.id,st.full_name,g.name group_name,c.name course FROM students st JOIN groups g ON g.id=st.group_id JOIN courses c ON c.id=g.course_id WHERE st.active=1 AND st.full_name LIKE ? ${unrestricted?'':'AND EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.group_id=st.group_id)'} ORDER BY st.full_name COLLATE NOCASE LIMIT 6`).bind(...(unrestricted?[pattern]:[pattern,user.id])).all():{results:[]},
      can(user,'groups.read')?db.prepare(`SELECT g.id,g.name group_name,c.name course FROM groups g JOIN courses c ON c.id=g.course_id WHERE g.active=1 AND g.name LIKE ? ${unrestricted?'':'AND EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.group_id=g.id)'} ORDER BY c.name,g.name LIMIT 6`).bind(...(unrestricted?[pattern]:[pattern,user.id])).all():{results:[]},
      can(user,'courses.read')?db.prepare(`SELECT DISTINCT c.id,c.name FROM courses c ${unrestricted?'':'JOIN instructor_assignments a ON a.course_id=c.id'} WHERE c.active=1 AND c.name LIKE ? ${unrestricted?'':'AND a.instructor_id=?'} ORDER BY c.name LIMIT 6`).bind(...(unrestricted?[pattern]:[pattern,user.id])).all():{results:[]},
      can(user,'sessions.read')?db.prepare(`SELECT s.id,s.session_date,s.start_time,c.name course,g.name group_name,u.full_name instructor FROM sessions s JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id WHERE s.active=1 AND (c.name LIKE ? OR g.name LIKE ? OR u.full_name LIKE ? OR s.room LIKE ?) ${unrestricted?'':'AND (s.instructor_id=? OR EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.course_id=s.course_id AND a.group_id=s.group_id))'} ORDER BY s.session_date DESC,s.start_time DESC LIMIT 6`).bind(...(unrestricted?[pattern,pattern,pattern,pattern]:[pattern,pattern,pattern,pattern,user.id,user.id])).all():{results:[]},
      can(user,'users.read')?db.prepare("SELECT DISTINCT u.id,u.full_name FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active=1 AND r.role_code='instructor' AND u.full_name LIKE ? ORDER BY u.full_name LIMIT 6").bind(pattern).all():{results:[]}
    ]);
    items.push(...(students.results||[]).map(row=>({type:'student',id:row.id,name:row.full_name,context:`${row.course} · ${row.group_name}`})),...(groups.results||[]).map(row=>({type:'group',id:row.id,name:row.group_name,context:row.course})),...(courses.results||[]).map(row=>({type:'course',id:row.id,name:row.name,context:'Course'})),...(sessions.results||[]).map(row=>({type:'session',id:row.id,name:`${row.course} · ${row.group_name}`,context:`${row.session_date} · ${row.start_time||'Time not set'} · ${row.instructor}`})),...(instructors.results||[]).map(row=>({type:'instructor',id:row.id,name:row.full_name,context:'Instructor'})));
    return json(items);
  }
  if (method === 'GET' && path === '/api/dashboard') {
    const unrestricted=isAdmin(user)||isViewer(user);
    const scope = unrestricted ? '' : ' AND (s.instructor_id=? OR EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.course_id=s.course_id AND a.group_id=s.group_id))';
    const bind = unrestricted ? [] : [user.id,user.id];
    const [students,groups,courses,sessions,stats,recent] = await Promise.all([
      db.prepare(`SELECT COUNT(*) n FROM students WHERE active=1${unrestricted?'':' AND group_id IN (SELECT group_id FROM instructor_assignments WHERE instructor_id=?)'}`).bind(...(unrestricted?[]:[user.id])).first(),
      db.prepare(unrestricted?'SELECT COUNT(*) n FROM groups WHERE active=1':'SELECT COUNT(DISTINCT group_id) n FROM instructor_assignments WHERE instructor_id=?').bind(...(unrestricted?[]:[user.id])).first(),
      db.prepare(`SELECT COUNT(DISTINCT c.id) n FROM courses c ${unrestricted?'WHERE c.active=1':'JOIN instructor_assignments a ON a.course_id=c.id WHERE a.instructor_id=? AND c.active=1'}`).bind(...(unrestricted?[]:[user.id])).first(),
      db.prepare(`SELECT COUNT(*) n FROM sessions s WHERE s.active=1 AND substr(s.session_date,1,7)=substr(date('now'),1,7)${scope}`).bind(...bind).first(),
      db.prepare(`SELECT COUNT(*) total, SUM(a.status='present') present FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.active=1${scope}`).bind(...bind).first(),
      db.prepare(`SELECT s.id,s.session_date,s.start_time,s.end_time,s.room,c.name course,g.name group_name,u.full_name instructor,COUNT(a.id) marked,SUM(a.status='present') present FROM sessions s JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id LEFT JOIN attendance a ON a.session_id=s.id WHERE s.active=1${scope} GROUP BY s.id ORDER BY s.session_date DESC,s.start_time DESC LIMIT 6`).bind(...bind).all()
    ]);
    const workday=url.searchParams.get('date')||new Date().toISOString().slice(0,10);if(!validDate(workday))return fail('Choose a valid dashboard date.');const groupScope=unrestricted?'':' AND EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.group_id=g.id)',groupBind=unrestricted?[]:[user.id];
    const [today,noSessionToday,atRisk,activity]=await Promise.all([
      db.prepare(`SELECT s.id,s.session_date,s.start_time,s.end_time,s.room,c.name course,g.id group_id,g.name group_name,u.full_name instructor,COUNT(a.id) marked,SUM(a.status='present') present FROM sessions s JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id LEFT JOIN attendance a ON a.session_id=s.id WHERE s.active=1 AND s.session_date=?${scope} GROUP BY s.id ORDER BY s.start_time,c.name,g.name LIMIT 20`).bind(workday,...bind).all(),
      db.prepare(`SELECT g.id,g.name group_name,c.name course FROM groups g JOIN courses c ON c.id=g.course_id WHERE g.active=1 AND c.active=1 AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.group_id=g.id AND s.active=1 AND s.session_date=?)${groupScope} ORDER BY c.name,g.name LIMIT 6`).bind(workday,...groupBind).all(),
      db.prepare(`SELECT g.id,g.name group_name,c.name course,ROUND(100.0*SUM(a.status='present')/COUNT(a.id)) attendance_rate FROM groups g JOIN courses c ON c.id=g.course_id JOIN sessions s ON s.group_id=g.id AND s.active=1 JOIN attendance a ON a.session_id=s.id WHERE g.active=1 AND c.active=1${scope} GROUP BY g.id HAVING COUNT(a.id)>0 AND attendance_rate<75 ORDER BY attendance_rate,g.name LIMIT 6`).bind(...bind).all(),
      db.prepare(`SELECT a.action,a.entity_type,u.full_name actor,a.created_at FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE ?=1 OR a.actor_id=? ORDER BY a.created_at DESC LIMIT 6`).bind(can(user,'audit_logs.read')?1:0,user.id).all()
    ]);
    return json({ students:students?.n||0,groups:groups?.n||0,courses:courses?.n||0,sessions:sessions?.n||0,attendanceRate:stats?.total?Math.round(100*stats.present/stats.total):0,recent:recent.results||[],today:today.results||[],noSessionToday:noSessionToday.results||[],atRisk:atRisk.results||[],activity:activity.results||[],workday });
  }
  if (method === 'GET' && path === '/api/groups') {
    if(requireCapability(user,'groups.read'))return requireCapability(user,'groups.read');
    const unrestricted=isAdmin(user)||isViewer(user);
    const course=url.searchParams.get('course')||'',q=cleanText(url.searchParams.get('q'),100),active=url.searchParams.get('active')||'true';
    const rows = await db.prepare(`SELECT g.*,c.name course,(SELECT COUNT(*) FROM students st WHERE st.group_id=g.id AND st.active=1) student_count FROM groups g LEFT JOIN courses c ON c.id=g.course_id ${unrestricted?'':'JOIN instructor_assignments a ON a.group_id=g.id WHERE a.instructor_id=?'} ${unrestricted?'WHERE 1=1':'AND 1=1'} AND (?='' OR g.course_id=?) AND (?='' OR g.name LIKE ?) AND (?='all' OR g.active=?) ORDER BY c.name,g.name LIMIT 500`).bind(...(unrestricted?[]:[user.id]),course,course,q,`%${q}%`,active,active==='false'?0:1).all();
    return json(rows.results);
  }
  const historyMatch=path.match(/^\/api\/groups\/([^/]+)\/history$/);
  if(historyMatch&&method==='GET'){
    for(const permission of ['groups.read','sessions.read','attendance.read']){
      const denied=requireCapability(user,permission);if(denied)return denied;
    }
    const group=await db.prepare('SELECT id,course_id FROM groups WHERE id=?').bind(historyMatch[1]).first();
    if(!group)return fail('Group not found.',404);
    const unrestricted=isAdmin(user)||isViewer(user);
    if(!unrestricted&&!await assigned(db,user,group.course_id,group.id))return fail('You do not have access to this group.',403);
    const scope=unrestricted?'':'AND (s.instructor_id=? OR EXISTS(SELECT 1 FROM instructor_assignments z WHERE z.instructor_id=? AND z.course_id=s.course_id AND z.group_id=s.group_id))';
    const result=await db.prepare(`WITH visible_sessions AS (
      SELECT s.id FROM sessions s WHERE s.group_id=? AND s.active=1 ${scope}
      ORDER BY s.session_date DESC,s.start_time DESC,s.id LIMIT 500
    ) SELECT a.session_id,a.id attendance_id,a.student_key,
      COALESCE(NULLIF(a.student_name_snapshot,''),st.full_name) full_name,st.active,a.status
      FROM visible_sessions s JOIN attendance a ON a.session_id=s.id
      LEFT JOIN students st ON st.id=a.student_key LIMIT 50001`).bind(group.id,...(unrestricted?[]:[user.id,user.id])).all();
    if(result.results.length>50000)return fail('This group history exceeds 50,000 marks. Use Reports with a narrower date range to inspect its attendance.',413);
    return json({rows:result.results});
  }
  if (method === 'POST' && path === '/api/groups') {
    if (requireCapability(user,'groups.create')) return requireCapability(user,'groups.create');
    const input=await body(req),name=cleanText(input?.name,100),courseId=cleanText(input?.course_id,80); if(!name||!courseId)return fail('Choose a course and enter a group name.');
    if(!await db.prepare('SELECT 1 FROM courses WHERE id=? AND active=1').bind(courseId).first())return fail('Choose an active course.');
    const groupId=id(); try { await db.prepare('INSERT INTO groups(id,name,course_id) VALUES(?,?,?)').bind(groupId,name,courseId).run(); } catch { return fail('A group with this name already exists.',409); }
    await audit(db,user,'created','group',groupId,{name,course_id:courseId}); return json({id:groupId,name,course_id:courseId},201);
  }
  let match=path.match(/^\/api\/groups\/([^/]+)$/);
  if (match && method==='PATCH') { if(requireCapability(user,'groups.update'))return requireCapability(user,'groups.update'); const x=await body(req),current=await db.prepare('SELECT * FROM groups WHERE id=?').bind(match[1]).first();if(!current)return fail('Group not found.',404);const name=x?.name===undefined?current.name:cleanText(x.name,100),courseId=x?.course_id===undefined?current.course_id:cleanText(x.course_id,80);if(!name||!courseId)return fail('Choose a course and enter a group name.');if(x?.active!==undefined&&typeof x.active!=='boolean')return fail('Group status must be active or inactive.');if(!await db.prepare('SELECT 1 FROM courses WHERE id=? AND active=1').bind(courseId).first())return fail('Choose an active course.');if(x?.active===false&&current.active)try{await createBackup(db,user,'group_archive',current.id,current);}catch(error){return fail(error.message||'Could not create a recovery backup.');}try{await db.prepare('UPDATE groups SET name=?,course_id=?,active=COALESCE(?,active) WHERE id=?').bind(name,courseId,x?.active===undefined?null:(x.active?1:0),match[1]).run();}catch{return fail('A group with this name already exists.',409);}await audit(db,user,x?.active===true?'restored':'updated','group',match[1],{name,course_id:courseId,active:x?.active});return json({ok:true}); }
  if (method==='GET'&&path==='/api/courses') {
    if(requireCapability(user,'courses.read'))return requireCapability(user,'courses.read');
    const unrestricted=isAdmin(user)||isViewer(user);
    const active=url.searchParams.get('active')||'true';const r=await db.prepare(`SELECT DISTINCT c.*, (SELECT COUNT(*) FROM groups g WHERE g.course_id=c.id AND g.active=1) group_count FROM courses c ${unrestricted?'':'JOIN instructor_assignments a ON a.course_id=c.id WHERE a.instructor_id=?'} ${unrestricted?"WHERE (?='all' OR c.active=?)":'AND c.active=1'} ORDER BY c.name`).bind(...(unrestricted?[active,active==='false'?0:1]:[user.id])).all(); return json(r.results);
  }
  if (method==='POST'&&path==='/api/courses') { if(requireCapability(user,'courses.create'))return requireCapability(user,'courses.create'); const x=await body(req),name=cleanText(x?.name,160),description=cleanText(x?.description,500); if(!name)return fail('Course name is required.'); const courseId=id(); try{await db.prepare('INSERT INTO courses(id,name,description) VALUES(?,?,?)').bind(courseId,name,description).run();}catch{return fail('A course with this name already exists.',409);} await audit(db,user,'created','course',courseId,{name});return json({id:courseId,name,description},201); }
  match=path.match(/^\/api\/courses\/([^/]+)$/);
  if(match&&method==='PATCH'){if(requireCapability(user,'courses.update'))return requireCapability(user,'courses.update');const x=await body(req),current=await db.prepare('SELECT * FROM courses WHERE id=?').bind(match[1]).first();if(!current)return fail('Course not found.',404);const name=x?.name===undefined?current.name:cleanText(x.name,160);if(!name)return fail('Course name is required.');if(x?.active!==undefined&&typeof x.active!=='boolean')return fail('Course status must be active or inactive.');if(x?.active===false&&current.active)try{await createBackup(db,user,'course_archive',current.id,current);}catch(error){return fail(error.message||'Could not create a recovery backup.');}try{await db.prepare('UPDATE courses SET name=?,description=COALESCE(?,description),active=COALESCE(?,active) WHERE id=?').bind(name,x?.description===undefined?null:cleanText(x.description,500),x?.active===undefined?null:(x.active?1:0),match[1]).run();}catch{return fail('A course with this name already exists.',409);}await audit(db,user,x?.active===true?'restored':'updated','course',match[1],{name,active:x?.active});return json({ok:true});}
  if(method==='GET'&&path==='/api/students'){
    if(requireCapability(user,'students.read'))return requireCapability(user,'students.read');
    const search=cleanText(url.searchParams.get('q'),100),group=url.searchParams.get('group')||'',active=url.searchParams.get('active')||'true';
    const unrestricted=isAdmin(user)||isViewer(user);
    const sql=`SELECT st.id,st.full_name,st.group_id,st.active,g.course_id,c.name course,g.name group_name FROM students st JOIN groups g ON g.id=st.group_id LEFT JOIN courses c ON c.id=g.course_id WHERE (?='' OR st.full_name LIKE ?) AND (?='' OR st.group_id=?) AND (?='all' OR st.active=?) ${unrestricted?'':'AND EXISTS(SELECT 1 FROM instructor_assignments a WHERE a.instructor_id=? AND a.group_id=st.group_id)'} ORDER BY c.name,g.name,st.full_name COLLATE NOCASE LIMIT 500`;
    const params=[search,`%${search}%`,group,group,active,active==='false'?0:1,...(unrestricted?[]:[user.id])]; return json((await db.prepare(sql).bind(...params).all()).results);
  }
  if(method==='POST'&&path==='/api/students'){
    if(requireCapability(user,'students.create'))return requireCapability(user,'students.create');const x=await body(req),name=cleanText(x?.full_name,150),group=x?.group_id;
    if(!name||!group)return fail('Student name and group are required.');if(!await db.prepare('SELECT 1 FROM groups WHERE id=? AND active=1').bind(group).first())return fail('Choose an active group.');
    const existing=(await db.prepare('SELECT full_name FROM students WHERE group_id=?').bind(group).all()).results||[];if(existing.some(student=>normalizeStudentName(student.full_name)===normalizeStudentName(name)))return fail('A student with this name already exists in the selected group.',409);
    const studentId=id();await db.prepare('INSERT INTO students(id,full_name,group_id) VALUES(?,?,?)').bind(studentId,name,group).run();await audit(db,user,'created','student',studentId,{group_id:group});return json({id:studentId},201);
  }
  if(method==='POST'&&path==='/api/students/delete-selected'){
    if(requireCapability(user,'students.delete'))return requireCapability(user,'students.delete');
    const x=await body(req),studentIds=[...new Set(Array.isArray(x?.student_ids)?x.student_ids.filter(value=>typeof value==='string'&&value.length<=80):[])];if(!studentIds.length||studentIds.length>100)return fail('Select between 1 and 100 students to delete.');
    const marks=studentIds.map(()=>'?').join(','),students=(await db.prepare(`SELECT * FROM students WHERE id IN (${marks})`).bind(...studentIds).all()).results||[];if(students.length!==studentIds.length)return fail('One or more selected students no longer exist.',409);
    if(!isAdmin(user))for(const student of students){const group=await db.prepare('SELECT course_id FROM groups WHERE id=?').bind(student.group_id).first();if(!group||!await assigned(db,user,group.course_id,student.group_id))return fail('You can delete students only from your assigned groups.',403);}
    const attendance=(await db.prepare(`SELECT a.id,a.session_id,a.student_key,a.student_name_snapshot,a.status,a.recorded_by,a.updated_at FROM attendance a WHERE a.student_key IN (${marks})`).bind(...studentIds).all()).results||[];
    try{await createBackup(db,user,'student_deletion',null,{students,attendance});}catch(error){return fail(error.message||'Could not create a recovery backup.');}
    await db.prepare(`DELETE FROM students WHERE id IN (${marks})`).bind(...studentIds).run();await audit(db,user,'deleted','students',null,{count:students.length,attendance_preserved:attendance.length});return json({deleted:students.length,attendance:attendance.length});
  }
  if(method==='POST'&&path==='/api/attendance/delete-selected'){
    if(requireCapability(user,'attendance.delete'))return requireCapability(user,'attendance.delete');
    const x=await body(req),attendanceIds=[...new Set(Array.isArray(x?.attendance_ids)?x.attendance_ids.filter(value=>typeof value==='string'&&value.length<=80):[])];if(!attendanceIds.length||attendanceIds.length>500)return fail('Select between 1 and 500 attendance records to delete.');
    const marks=attendanceIds.map(()=>'?').join(','),attendance=(await db.prepare(`SELECT a.id,a.session_id,a.student_key,a.student_name_snapshot,a.status,a.recorded_by,a.updated_at FROM attendance a WHERE a.id IN (${marks})`).bind(...attendanceIds).all()).results||[];if(attendance.length!==attendanceIds.length)return fail('One or more attendance records no longer exist.',409);
    for(const sessionId of new Set(attendance.map(row=>row.session_id))){const access=await sessionAccess(db,user,sessionId,true);if(access.error)return access.error;}
    try{await createBackup(db,user,'attendance_deletion',null,{attendance});}catch(error){return fail(error.message||'Could not create a recovery backup.');}
    await db.prepare(`DELETE FROM attendance WHERE id IN (${marks})`).bind(...attendanceIds).run();await audit(db,user,'deleted','attendance',null,{count:attendance.length});return json({deleted:attendance.length});
  }
  match=path.match(/^\/api\/students\/([^/]+)$/);
  if(match&&method==='PATCH'){if(requireCapability(user,'students.update'))return requireCapability(user,'students.update');const x=await body(req),current=await db.prepare('SELECT * FROM students WHERE id=?').bind(match[1]).first();if(!current)return fail('Student not found.',404);const name=x?.full_name===undefined?current.full_name:cleanText(x.full_name,150),group=x?.group_id===undefined?current.group_id:x.group_id;if(!name||!group)return fail('Student name and group are required.');if(x?.active!==undefined&&typeof x.active!=='boolean')return fail('Student status must be active or inactive.');const groupRow=await db.prepare('SELECT active FROM groups WHERE id=?').bind(group).first();if(!groupRow||(groupRow.active!==1&&group!==current.group_id))return fail('Choose an active group.');const others=(await db.prepare('SELECT id,full_name FROM students WHERE group_id=? AND id<>?').bind(group,match[1]).all()).results||[];if(others.some(student=>normalizeStudentName(student.full_name)===normalizeStudentName(name)))return fail('A student with this name already exists in the selected group.',409);await db.prepare('UPDATE students SET full_name=?,group_id=?,active=COALESCE(?,active),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,group,x?.active===undefined?null:(x.active?1:0),match[1]).run();await audit(db,user,'updated','student',match[1],{group_id:group,active:x?.active});return json({ok:true});}
  if(method==='GET'&&path==='/api/instructors'){if(requireCapability(user,'users.read'))return requireCapability(user,'users.read');const result=await db.prepare("SELECT u.id,u.email,u.full_name,u.active,u.created_at,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role_code='instructor' ORDER BY u.full_name").all();return json((result.results||[]).map(row=>({...row,roles:row.roles?row.roles.split(','):[]})));}
  if(method==='POST'&&path==='/api/instructors'){if(requireCapability(user,'users.create'))return requireCapability(user,'users.create');const x=await body(req),email=cleanText(x?.email,254).toLowerCase(),name=cleanText(x?.name,150),password=x?.password;if(!validAccountEmail(email,env.ALLOWED_EMAIL_DOMAINS)||!name||typeof password!=='string'||password.length<12||password.length>256)return fail('Provide a valid, permitted email, name, and temporary password of at least 12 characters.');const uid=id();try{await db.batch([db.prepare("INSERT INTO users(id,email,full_name,password_hash,role,must_change_password) VALUES(?,?,?,?, 'instructor',1)").bind(uid,email,name,await hashPassword(password)),db.prepare("INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,'instructor',?)").bind(uid,user.id)]);}catch{return fail('An account with this email already exists.',409);}await audit(db,user,'created','user',uid,{role:'instructor'});return json({id:uid},201);}
  match=path.match(/^\/api\/instructors\/([^/]+)$/);
  if(match&&method==='PATCH'){if(requireCapability(user,'users.update'))return requireCapability(user,'users.update');const x=await body(req),password=x?.password,target=await db.prepare("SELECT u.id,u.active,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u WHERE u.id=? AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role_code='instructor')").bind(match[1]).first();if(!target)return fail('Instructor account not found.',404);const targetRoles=(target.roles||'').split(',');if(targetRoles.some(role=>['admin','super_admin'].includes(role))&&!hasRole(user,'super_admin'))return fail('Only the super administrator can change administrator accounts.',403);if(x?.name!==undefined&&!cleanText(x.name,150))return fail('Enter a valid display name.');if(x?.active!==undefined&&typeof x.active!=='boolean')return fail('Instructor status must be active or inactive.');if(x?.active===false&&target.id===user.id)return fail('You cannot deactivate your own account.',409);if(password!==undefined&&(typeof password!=='string'||password.length<12||password.length>256))return fail('Temporary passwords must contain 12 to 256 characters.');await db.prepare("UPDATE users SET full_name=COALESCE(?,full_name),active=COALESCE(?,active),password_hash=COALESCE(?,password_hash),must_change_password=CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(x?.name===undefined?null:cleanText(x.name,150),x?.active===undefined?null:(x.active?1:0),typeof password==='string'?await hashPassword(password):null,typeof password==='string'?1:null,match[1]).run();if(x?.active===false)await db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(match[1]).run();await audit(db,user,x?.active===false?'disabled':password?'reset password':'updated','user',match[1]);return json({ok:true});}
  if(method==='GET'&&path==='/api/users'){
    if(requireCapability(user,'users.read'))return requireCapability(user,'users.read');
    const result=await db.prepare(`SELECT u.id,u.email,u.full_name,u.active,u.must_change_password,u.created_at,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles,(SELECT group_concat(permission_code) FROM user_permissions WHERE user_id=u.id) extra_permissions FROM users u ORDER BY u.full_name`).all();
    return json(result.results.map(row=>({...row,roles:row.roles?row.roles.split(','):[],extra_permissions:row.extra_permissions?row.extra_permissions.split(','):[]})));
  }
  match=path.match(/^\/api\/users\/([^/]+)\/permissions$/);
  if(match&&method==='PUT'){
    if(requireCapability(user,'users.update'))return requireCapability(user,'users.update');
    const x=await body(req),permissions=[...new Set(Array.isArray(x?.permissions)?x.permissions:[])],allowed=['students.delete','attendance.delete','reports.export'];
    if(permissions.some(permission=>!allowed.includes(permission)))return fail('Choose only supported additional instructor capabilities.');
    const target=await db.prepare('SELECT u.id,u.full_name,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u WHERE u.id=?').bind(match[1]).first();
    const roles=(target?.roles||'').split(',');if(!target)return fail('User not found.',404);if(!roles.includes('instructor')||roles.some(role=>['admin','super_admin','viewer'].includes(role)))return fail('Additional capabilities can only be granted to instructor accounts.',409);
    await db.batch([db.prepare('DELETE FROM user_permissions WHERE user_id=?').bind(target.id),...permissions.map(permission=>db.prepare('INSERT INTO user_permissions(user_id,permission_code,granted_by) VALUES(?,?,?)').bind(target.id,permission,user.id))]);
    await audit(db,user,'changed permissions','user',target.id,{name:target.full_name,permissions});return json({ok:true,permissions});
  }
  if(method==='POST'&&path==='/api/users'){
    if(requireCapability(user,'users.create'))return requireCapability(user,'users.create');
    const x=await body(req),email=cleanText(x?.email,254).toLowerCase(),name=cleanText(x?.name,150),roles=[...new Set(Array.isArray(x?.roles)?x.roles:[])];
    const validRoles=['admin','instructor','viewer','super_admin'];
    if(!validAccountEmail(email,env.ALLOWED_EMAIL_DOMAINS)||!name||!roles.length||roles.some(role=>!validRoles.includes(role))||roles.includes('viewer')&&roles.length>1)return fail('Provide a valid, permitted email, name, and compatible roles. Viewer access must remain read-only.');
    if(roles.includes('super_admin'))return fail('The owner account is created only during initial setup.',403);
    if(roles.includes('admin')&&!hasRole(user,'super_admin'))return fail('Only a super administrator can create administrator accounts.',403);
    const uid=id(),password=b64(crypto.getRandomValues(new Uint8Array(24))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),legacyRole=roles.includes('admin')||roles.includes('super_admin')?'admin':'instructor';
    const statements=[db.prepare('INSERT INTO users(id,email,full_name,password_hash,role,must_change_password) VALUES(?,?,?,?,?,1)').bind(uid,email,name,await hashPassword(password),legacyRole),...roles.map(role=>db.prepare('INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,?,?)').bind(uid,role,user.id))];
    try{await db.batch(statements);}catch{return fail('That email address is already in use.',409);}
    await audit(db,user,'created','user',uid,{roles});return json({id:uid,email,temporary_password:password,must_change_password:true,roles},201);
  }
  match=path.match(/^\/api\/users\/([^/]+)\/roles$/);
  if(match&&method==='PUT'){
    if(!hasRole(user,'super_admin'))return fail('Only the super administrator can manage account roles.',403);
    const x=await body(req),roles=[...new Set(Array.isArray(x?.roles)?x.roles:[])],validRoles=['admin','instructor','viewer','super_admin'];
    if(!roles.length||roles.some(role=>!validRoles.includes(role))||roles.includes('viewer')&&roles.length>1)return fail('Choose compatible roles. Viewer access must remain read-only.');
    const target=await db.prepare('SELECT u.id,u.email,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u WHERE id=?').bind(match[1]).first();if(!target)return fail('User not found.',404);
    if((target.roles||'').split(',').includes('super_admin')&&!roles.includes('super_admin'))return fail('The workspace owner must retain super administrator access.',409);
    if(roles.includes('super_admin')&&!(target.roles||'').split(',').includes('super_admin'))return fail('The super administrator role is reserved for the initial workspace owner.',403);
    await db.batch([db.prepare('DELETE FROM user_roles WHERE user_id=?').bind(match[1]),db.prepare('DELETE FROM user_permissions WHERE user_id=?').bind(match[1]),...roles.map(role=>db.prepare('INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,?,?)').bind(match[1],role,user.id)),db.prepare("UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(roles.includes('admin')||roles.includes('super_admin')?'admin':'instructor',match[1])]);
    await audit(db,user,'changed roles','user',match[1],{roles});return json({ok:true});
  }
  match=path.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if(match&&method==='POST'){
    if(requireCapability(user,'users.update'))return requireCapability(user,'users.update');
    const target=await db.prepare('SELECT u.id,u.email,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u WHERE id=?').bind(match[1]).first();if(!target)return fail('User not found.',404);
    if(target.id===user.id)return fail('Use Profile & settings to change your own password.',409);
    const targetRoles=(target.roles||'').split(',');if(targetRoles.some(role=>['admin','super_admin'].includes(role))&&!hasRole(user,'super_admin'))return fail('Only a super administrator can reset administrator accounts.',403);
    const password=b64(crypto.getRandomValues(new Uint8Array(24))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    await db.prepare('UPDATE users SET password_hash=?,must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashPassword(password),match[1]).run();
    await db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(match[1]).run();await audit(db,user,'reset password','user',match[1]);
    return json({email:target.email,temporary_password:password,must_change_password:true});
  }
  match=path.match(/^\/api\/users\/([^/]+)$/);
  if(match&&method==='PATCH'){
    if(requireCapability(user,'users.update'))return requireCapability(user,'users.update');
    const target=await db.prepare('SELECT u.id,u.email,u.full_name,u.active,(SELECT group_concat(role_code) FROM user_roles WHERE user_id=u.id) roles FROM users u WHERE id=?').bind(match[1]).first();if(!target)return fail('User not found.',404);
    const targetRoles=(target.roles||'').split(',');if(targetRoles.some(role=>['admin','super_admin'].includes(role))&&!hasRole(user,'super_admin'))return fail('Only a super administrator can change administrator accounts.',403);
    const x=await body(req);if(x?.name!==undefined&&!cleanText(x.name,150))return fail('Enter a valid display name.');if(x?.active!==undefined&&typeof x.active!=='boolean')return fail('Account status must be active or inactive.');if(x?.active===false&&target.id===user.id)return fail('You cannot disable your own account.',409);if(x?.active===false&&targetRoles.includes('super_admin')&&!hasRole(user,'super_admin'))return fail('Only a super administrator can disable this account.',403);
    if(x?.active===false&&targetRoles.includes('super_admin'))return fail('The designated super administrator cannot be disabled.',409);
    await db.prepare('UPDATE users SET full_name=COALESCE(?,full_name),active=COALESCE(?,active),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(x?.name?cleanText(x.name,150):null,x?.active===undefined?null:(x.active?1:0),match[1]).run();
    if(x?.active===false)await db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(match[1]).run();
    await audit(db,user,x?.active===false?'disabled':'updated','user',match[1],{name:target.full_name});return json({ok:true});
  }
  if(method==='GET'&&path==='/api/assignments'){if(requireCapability(user,'assignments.read'))return requireCapability(user,'assignments.read');return json((await db.prepare('SELECT a.*,u.full_name instructor,c.name course,g.name group_name FROM instructor_assignments a JOIN users u ON u.id=a.instructor_id JOIN courses c ON c.id=a.course_id JOIN groups g ON g.id=a.group_id ORDER BY u.full_name,c.name,g.name').all()).results);}
  if(method==='POST'&&path==='/api/assignments'){if(requireCapability(user,'assignments.create'))return requireCapability(user,'assignments.create');const x=await body(req);if(!x?.instructor_id||!x?.course_id||!x?.group_id)return fail('Choose an instructor, course, and group.');const group=await db.prepare('SELECT course_id FROM groups WHERE id=? AND active=1').bind(x.group_id).first(),instructor=await db.prepare("SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.id=? AND u.active=1 AND r.role_code='instructor'").bind(x.instructor_id).first(),course=await db.prepare('SELECT 1 FROM courses WHERE id=? AND active=1').bind(x.course_id).first();if(!group||group.course_id!==x.course_id||!instructor||!course)return fail('Choose an active instructor and a group belonging to the active course.');const assignmentId=id();try{await db.prepare('INSERT INTO instructor_assignments(id,instructor_id,course_id,group_id) VALUES(?,?,?,?)').bind(assignmentId,x.instructor_id,x.course_id,x.group_id).run();}catch{return fail('This instructor is already assigned to that course and group.',409);}await audit(db,user,'created','instructor_assignment',assignmentId,{instructor_id:x.instructor_id,course_id:x.course_id,group_id:x.group_id});return json({id:assignmentId,ok:true},201);}
  match=path.match(/^\/api\/assignments\/([^/]+)$/);if(match&&method==='DELETE'){if(requireCapability(user,'assignments.delete'))return requireCapability(user,'assignments.delete');const result=await db.prepare('DELETE FROM instructor_assignments WHERE id=?').bind(match[1]).run();if(!result.meta?.changes)return fail('Assignment not found.',404);await audit(db,user,'deleted','instructor_assignment',match[1]);return json({ok:true});}
  if(method==='GET'&&path==='/api/sessions'){
    if(requireCapability(user,'sessions.read'))return requireCapability(user,'sessions.read');
    const group=url.searchParams.get('group')||'',course=url.searchParams.get('course')||'',from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'',q=cleanText(url.searchParams.get('q'),100),room=cleanText(url.searchParams.get('room'),80);
    if(from&&!validDate(from)||to&&!validDate(to))return fail('Choose valid start and end dates.');
    const unrestricted=isAdmin(user)||isViewer(user);
    const scope=unrestricted?'':'AND (s.instructor_id=? OR EXISTS(SELECT 1 FROM instructor_assignments z WHERE z.instructor_id=? AND z.course_id=s.course_id AND z.group_id=s.group_id))';
    const binds=[group,group,course,course,from,from,to,to,q,`%${q}%`,`%${q}%`,`%${q}%`,room,`%${room}%`,...(unrestricted?[]:[user.id,user.id])];
    const sql=`SELECT s.id,s.course_id,s.group_id,s.instructor_id,s.session_date,s.start_time,s.end_time,s.room,s.duration_minutes,s.notes,c.name course,g.name group_name,u.full_name instructor,COUNT(a.id) marked,SUM(a.status='present') present FROM sessions s JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id LEFT JOIN attendance a ON a.session_id=s.id WHERE s.active=1 AND (?='' OR s.group_id=?) AND (?='' OR s.course_id=?) AND (?='' OR s.session_date>=?) AND (?='' OR s.session_date<=?) AND (?='' OR c.name LIKE ? OR g.name LIKE ? OR u.full_name LIKE ?) AND (?='' OR s.room LIKE ?) ${scope} GROUP BY s.id ORDER BY s.session_date DESC,s.start_time DESC,s.id LIMIT 500`;
    return json((await db.prepare(sql).bind(...binds).all()).results);
  }
  if(method==='POST'&&path==='/api/sessions'){
    if(requireCapability(user,'sessions.create'))return requireCapability(user,'sessions.create');
    const x=await body(req),course=x?.course_id,group=x?.group_id,date=x?.session_date,start=cleanText(x?.start_time,5),room=cleanText(x?.room,80);let end=cleanText(x?.end_time,5),mins=Number(x?.duration_minutes||60);
    if(!course||!group||!validDate(date)||!Number.isInteger(mins)||mins<1||mins>600||start&&!validTime(start)||end&&!validTime(end)||end&&!start)return fail('Choose a course, group, valid date, and matching start/end times.');
    const courseRow=await db.prepare('SELECT 1 FROM courses WHERE id=? AND active=1').bind(course).first(),groupRow=await db.prepare('SELECT course_id FROM groups WHERE id=? AND active=1').bind(group).first();
    if(!courseRow||!groupRow||groupRow.course_id!==course)return fail('Choose an active course and a group that belongs to it.');
    const adminOverride=isAdmin(user)&&can(user,'settings.manage');
    if(!isAdmin(user)&&!await assigned(db,user,course,group))return fail('You are not assigned to this course and group.',403);
    if(start&&end){const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);mins=eh*60+em-(sh*60+sm);if(mins<1||mins>600)return fail('End time must be after the start time and no more than 10 hours later.');}else if(start){end=addMinutesToTime(start,mins);if(!end)return fail('The session must end before midnight.');}
    const instructor=adminOverride?cleanText(x?.instructor_id,80):user.id;
    const instructorRow=await db.prepare("SELECT u.active,EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role_code='instructor') instructor_role FROM users u WHERE u.id=?").bind(instructor).first();
    const instructorAssigned=!!await db.prepare('SELECT 1 FROM instructor_assignments WHERE instructor_id=? AND course_id=? AND group_id=?').bind(instructor,course,group).first();
    if(!canAssignSessionInstructor({active:instructorRow?.active===1,instructorRole:Boolean(instructorRow?.instructor_role),adminOverride,assigned:instructorAssigned}))return fail('Choose an active instructor allowed for this course and group.');
    const sid=id(),result=await db.prepare('INSERT INTO sessions(id,course_id,group_id,instructor_id,session_date,start_time,end_time,room,duration_minutes,notes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(sid,course,group,instructor,date,start,end,room,mins,cleanText(x?.notes,500)).run();
    const studs=await db.prepare('SELECT id,full_name FROM students WHERE group_id=? AND active=1').bind(group).all();if(studs.results.length){const statements=studs.results.map(st=>db.prepare('INSERT INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by) VALUES(?,?,?, ?,\'absent\',?)').bind(id(),sid,st.id,st.full_name,user.id));await db.batch(statements);}
    await audit(db,user,'created','session',sid,{course_id:course,group_id:group,session_date:date,start_time:start,end_time:end,room,instructor_id:instructor});return json({id:sid,marked:studs.results.length},201);
  }
  match=path.match(/^\/api\/sessions\/([^/]+)$/);
  if(match&&method==='GET'){
    const access=await sessionAccess(db,user,match[1]);if(access.error)return access.error;const result=await db.prepare("SELECT s.id,s.course_id,s.group_id,s.instructor_id,s.session_date,s.start_time,s.end_time,s.room,s.duration_minutes,s.notes,s.active,c.name course,g.name group_name,u.full_name instructor,COUNT(a.id) marked,SUM(a.status='present') present FROM sessions s JOIN courses c ON c.id=s.course_id JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=s.instructor_id LEFT JOIN attendance a ON a.session_id=s.id WHERE s.id=? GROUP BY s.id").bind(match[1]).first();return result?json(result):fail('Session not found.',404);
  }
  if(match&&method==='PATCH'){
    if(requireCapability(user,'sessions.update'))return requireCapability(user,'sessions.update');
    const current=await db.prepare('SELECT * FROM sessions WHERE id=?').bind(match[1]).first();if(!current)return fail('Session not found.',404);if(!current.active)return fail('This session is archived.',409);if(!isAdmin(user)&&current.instructor_id!==user.id)return fail('You can edit only your own sessions.',403);
    const x=await body(req),course=x?.course_id===undefined?current.course_id:x.course_id,group=x?.group_id===undefined?current.group_id:x.group_id,date=x?.session_date===undefined?current.session_date:x.session_date,start=x?.start_time===undefined?current.start_time:cleanText(x.start_time,5),end=x?.end_time===undefined?current.end_time:cleanText(x.end_time,5),room=x?.room===undefined?current.room:cleanText(x.room,80),instructor=x?.instructor_id===undefined?current.instructor_id:cleanText(x.instructor_id,80);
    if(!validDate(date)||start&&!validTime(start)||end&&!validTime(end)||end&&!start)return fail('Choose a valid date and matching start/end times.');
    const courseRow=await db.prepare('SELECT 1 FROM courses WHERE id=? AND active=1').bind(course).first(),groupRow=await db.prepare('SELECT course_id FROM groups WHERE id=? AND active=1').bind(group).first();
    if(!courseRow||!groupRow||groupRow.course_id!==course)return fail('Choose an active course and a group that belongs to it.');
    if(!isAdmin(user)&&!await assigned(db,user,course,group))return fail('You are not assigned to this course and group.',403);
    const instructorChanged=instructor!==current.instructor_id,adminOverride=isAdmin(user)&&can(user,'settings.manage');
    if(instructorChanged&&(!isAdmin(user)||!can(user,'settings.manage')))return fail('You do not have permission to reassign this session.',403);
    if(instructorChanged||course!==current.course_id||group!==current.group_id){
      const instructorRow=await db.prepare("SELECT u.active,EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role_code='instructor') instructor_role FROM users u WHERE u.id=?").bind(instructor).first();
      const instructorAssigned=!!await db.prepare('SELECT 1 FROM instructor_assignments WHERE instructor_id=? AND course_id=? AND group_id=?').bind(instructor,course,group).first();
      if(!canAssignSessionInstructor({active:instructorRow?.active===1,instructorRole:Boolean(instructorRow?.instructor_role),adminOverride,assigned:instructorAssigned}))return fail('Choose an active instructor allowed for this course and group.');
    }
    let mins=current.duration_minutes;if(start&&end){const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);mins=eh*60+em-(sh*60+sm);if(mins<1||mins>600)return fail('End time must be after the start time and no more than 10 hours later.');}
    await db.prepare('UPDATE sessions SET course_id=?,group_id=?,instructor_id=?,session_date=?,start_time=?,end_time=?,room=?,duration_minutes=?,notes=COALESCE(?,notes) WHERE id=?').bind(course,group,instructor,date,start,end,room,mins,x?.notes===undefined?null:cleanText(x.notes,500),match[1]).run();await audit(db,user,'updated','session',match[1],{course_id:course,group_id:group,session_date:date,start_time:start,end_time:end,room,instructor_id:instructor});return json({ok:true});
  }
  if(match&&method==='DELETE'){if(requireCapability(user,'sessions.delete'))return requireCapability(user,'sessions.delete');const session=await db.prepare('SELECT * FROM sessions WHERE id=? AND active=1').bind(match[1]).first();if(!session)return fail('Active session not found.',404);const attendance=(await db.prepare('SELECT * FROM attendance WHERE session_id=?').bind(match[1]).all()).results||[];try{await createBackup(db,user,'session_archive',session.id,{session,attendance});}catch(error){return fail(error.message||'Could not create a recovery backup.');}await db.prepare('UPDATE sessions SET active=0 WHERE id=?').bind(match[1]).run();await audit(db,user,'archived','session',match[1]);return json({ok:true});}
  match=path.match(/^\/api\/sessions\/([^/]+)\/attendance$/);
  if(match&&method==='GET'){const access=await sessionAccess(db,user,match[1]);if(access.error)return access.error;const r=await db.prepare('SELECT a.id attendance_id,a.student_key,COALESCE(NULLIF(a.student_name_snapshot,\'\'),st.full_name) full_name,st.active,a.status FROM attendance a LEFT JOIN students st ON st.id=a.student_key WHERE a.session_id=? ORDER BY full_name COLLATE NOCASE').bind(match[1]).all();return json(r.results);}
  if(match&&method==='PUT'){const access=await sessionAccess(db,user,match[1],true);if(access.error)return access.error;const x=await body(req);if(!Array.isArray(x?.attendance)||x.attendance.length>500)return fail('Attendance updates must include a list of up to 500 students.');const ids=new Set();for(const row of x.attendance){if(!row?.student_key||!['present','absent'].includes(row.status)||ids.has(row.student_key))return fail('Attendance contains an invalid or duplicate row.');ids.add(row.student_key);}const current=(await db.prepare('SELECT student_key FROM attendance WHERE session_id=?').bind(match[1]).all()).results||[];if(current.length!==ids.size||current.some(row=>!ids.has(row.student_key)))return fail('The attendance list changed. Reload this session and try again.',409);const statements=x.attendance.map(row=>db.prepare('UPDATE attendance SET status=?,recorded_by=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND student_key=?').bind(row.status,user.id,match[1],row.student_key));await db.batch(statements);await audit(db,user,'updated','attendance',match[1],{count:x.attendance.length});return json({saved:x.attendance.length});}
  if(method==='POST'&&path==='/api/import/attendance/preview'){
    if(requireCapability(user,'attendance.update'))return requireCapability(user,'attendance.update');const x=await body(req);if(!x?.session_id||!Array.isArray(x.rows)||!x.rows.length||x.rows.length>500)return fail('Choose a session and provide up to 500 attendance rows.');const access=await sessionAccess(db,user,x.session_id,true);if(access.error)return access.error;const roster=(await db.prepare('SELECT st.id student_key,st.full_name,a.status FROM attendance a JOIN students st ON st.id=a.student_key WHERE a.session_id=?').bind(x.session_id).all()).results||[],byName=new Map();for(const student of roster){const key=normalizeStudentName(student.full_name);byName.set(key,[...(byName.get(key)||[]),student]);}const seen=new Set();const rows=x.rows.map((r,i)=>{const fullName=cleanText(r.full_name,150),status=cleanText(r.status,20).toLocaleLowerCase(),key=normalizeStudentName(fullName),matches=byName.get(key)||[],student=matches.length===1?matches[0]:null;let issue='';if(!key)issue='Student Name is required.';else if(!['present','absent'].includes(status))issue='Status must be Present or Absent.';else if(!matches.length)issue='This name is not in the selected session roster.';else if(matches.length>1)issue='This name matches more than one student in the session roster.';else if(seen.has(key))issue='This student name appears more than once in the import.';if(key)seen.add(key);return {row:i+2,full_name:fullName,status,student_key:student?.student_key||null,issue,existing:student?{full_name:student.full_name,status:student.status}:null,decision:issue?'skip':'update'};});return json({rows,valid:rows.filter(row=>!row.issue).length,issues:rows.filter(row=>row.issue).length,session:{id:access.session.id,session_date:access.session.session_date,course_id:access.session.course_id,group_id:access.session.group_id}});
  }
  if(method==='POST'&&path==='/api/import/attendance/commit'){
    if(requireCapability(user,'attendance.update'))return requireCapability(user,'attendance.update');const x=await body(req);if(!x?.session_id||!Array.isArray(x.rows)||!x.rows.length||x.rows.length>500)return fail('Attendance import decisions are missing.');const access=await sessionAccess(db,user,x.session_id,true);if(access.error)return access.error;const roster=(await db.prepare('SELECT st.id student_key,st.full_name FROM attendance a JOIN students st ON st.id=a.student_key WHERE a.session_id=?').bind(x.session_id).all()).results||[],byKey=new Map(roster.map(student=>[student.student_key,student])),seen=new Set(),statements=[];let updated=0,skipped=0;for(const row of x.rows){if(row.decision==='skip'){skipped++;continue;}const key=row.student_key,student=byKey.get(key),name=cleanText(row.full_name,150),status=cleanText(row.status,20).toLocaleLowerCase();if(row.decision!=='update'||!student||normalizeStudentName(student.full_name)!==normalizeStudentName(name)||!['present','absent'].includes(status)||seen.has(key))return fail('An attendance row changed or is invalid. Review the preview and try again.',409);seen.add(key);statements.push(db.prepare('UPDATE attendance SET status=?,recorded_by=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND student_key=?').bind(status,user.id,x.session_id,key));updated++;}if(!updated)return fail('Every attendance row was skipped; nothing changed.');const importId=id();statements.push(db.prepare('INSERT INTO imports(id,imported_by,source,inserted_count,skipped_count) VALUES(?,?,?,?,?)').bind(importId,user.id,cleanText(x.source,30)||'CSV attendance',updated,skipped));await db.batch(statements);await audit(db,user,'imported','attendance',x.session_id,{updated,skipped,source:cleanText(x.source,30)});return json({updated,skipped},201);
  }
  if(method==='POST'&&path==='/api/import/preview'){
    if(requireCapability(user,'students.import'))return requireCapability(user,'students.import');
    const x=await body(req);
    if(!Array.isArray(x?.rows)||!x.rows.length||x.rows.length>2000)return fail('Import must contain between 1 and 2,000 rows.');
    if(!x.course_id||!x.group_id)return fail('Choose an active Course and Group in the workspace.');
    const target=await db.prepare('SELECT g.id,g.name,c.id course_id,c.name course FROM groups g JOIN courses c ON c.id=g.course_id WHERE g.id=? AND g.course_id=? AND g.active=1 AND c.active=1').bind(cleanText(x.group_id,80),cleanText(x.course_id,80)).first();
    if(!target)return fail('Choose an active Group belonging to the selected Course.');
    const existing=(await db.prepare('SELECT id,full_name FROM students WHERE group_id=?').bind(target.id).all()).results||[];
    const byName=new Map(existing.map(student=>[normalizeStudentName(student.full_name),student]));
    const imported=sortStudentsByName(x.rows.slice(0,2000).map((row,index)=>({row:index+2,full_name:cleanText(row?.full_name,150)})));
    const duplicateFlags=duplicateStudentNameFlags(imported.map(row=>row.full_name),existing.map(student=>student.full_name));
    const result=imported.map((row,index)=>{
      const key=normalizeStudentName(row.full_name),issue=key?'':'Student Name is required.',existingRow=byName.get(key)||null;
      const duplicate=duplicateFlags[index]?'possible_name':null;
      return {...row,group:target.name,course:target.course,group_id:target.id,course_id:target.course_id,issue,duplicate,existing:duplicate&&existingRow?{full_name:existingRow.full_name,group:target.name,course:target.course}:null,decision:duplicate?'skip':'insert'};
    });
    return json({rows:result,valid:result.filter(row=>!row.issue).length,issues:result.filter(row=>row.issue).length,course:{id:target.course_id,name:target.course},group:{id:target.id,name:target.name}});
  }
  if(method==='POST'&&path==='/api/import/commit'){
    if(requireCapability(user,'students.import'))return requireCapability(user,'students.import');const x=await body(req);if(!Array.isArray(x?.rows)||!x.rows.length||x.rows.length>2000||!x.course_id||!x.group_id)return fail('Choose a Course, Group, and valid import decisions.');const target=await db.prepare('SELECT g.id,c.id course_id FROM groups g JOIN courses c ON c.id=g.course_id WHERE g.id=? AND g.course_id=? AND g.active=1 AND c.active=1').bind(cleanText(x.group_id,80),cleanText(x.course_id,80)).first();if(!target)return fail('Choose an active Group belonging to the selected Course.');const existing=(await db.prepare('SELECT full_name FROM students WHERE group_id=?').bind(target.id).all()).results||[],names=new Set(existing.map(student=>normalizeStudentName(student.full_name))),statements=[];let inserted=0,skipped=0;const rows=sortStudentsByName(x.rows);for(const row of rows){const name=cleanText(row?.full_name,150),key=normalizeStudentName(name);if(row?.decision==='skip'){skipped++;continue;}if(row?.decision!=='insert'||!key)return fail('An import row changed or is invalid. Review the preview and try again.',409);if(names.has(key)&&row.allow_possible_duplicate!==true)return fail('A possible duplicate name needs explicit confirmation before import.',409);names.add(key);statements.push(db.prepare('INSERT INTO students(id,full_name,group_id) VALUES(?,?,?)').bind(id(),name,target.id));inserted++;}
    if(!inserted)return fail('Every row was skipped; nothing was imported.');const importId=id();statements.push(db.prepare('INSERT INTO imports(id,imported_by,source,inserted_count,skipped_count) VALUES(?,?,?,?,?)').bind(importId,user.id,cleanText(x.source,30)||'CSV',inserted,skipped));await db.batch(statements);await audit(db,user,'imported','students',importId,{inserted,skipped,source:cleanText(x.source,30),course_id:target.course_id,group_id:target.id});return json({imported:inserted,skipped},201);
  }
  if(method==='GET'&&path==='/api/attendance'){
    if(requireCapability(user,'reports.read'))return requireCapability(user,'reports.read');let offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0)offset=0;try{return json((await attendanceRows(db,user,url.searchParams,{limit:1000,offset})).rows);}catch(e){return fail(e.message||'Could not load attendance records.');}
  }
  if(method==='GET'&&(path==='/api/export/attendance.json'||path==='/api/export/attendance.csv')){
    if(requireCapability(user,'reports.export'))return requireCapability(user,'reports.export');let rows=[];try{for(let offset=0;offset<=20000;offset+=1000){const batch=await attendanceRows(db,user,url.searchParams,{limit:offset===20000?1:1000,offset});if(offset===20000&&batch.rows.length)return fail('This export exceeds 20,000 attendance marks. Narrow the date, course, or group filters and export again.',413);rows.push(...batch.rows);if(batch.rows.length<1000)break;}}catch(e){return fail(e.message||'Could not load attendance records.');}
    await audit(db,user,'exported','attendance',null,{format:path.endsWith('.csv')?'CSV':'XLSX/PDF data',count:rows.length});
    if(path.endsWith('.json'))return json(rows);
    const csv=attendanceCsvText(rows);return new Response('\ufeff'+csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="attendance.csv"','cache-control':'no-store'} });
  }
  if(method==='GET'&&path==='/api/backups'){
    if(requireCapability(user,'backups.manage'))return requireCapability(user,'backups.manage');
    const rows=await db.prepare('SELECT b.id,b.resource_type,b.resource_id,b.record_count,b.created_at,u.full_name created_by FROM backups b JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC LIMIT 200').all();return json(rows.results||[]);
  }
  match=path.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if(match&&method==='POST'){
    if(requireCapability(user,'backups.manage'))return requireCapability(user,'backups.manage');
    const backup=await db.prepare('SELECT * FROM backups WHERE id=?').bind(match[1]).first();if(!backup)return fail('Backup not found.',404);let data;try{data=JSON.parse(backup.data_json);}catch{return fail('This backup cannot be read.',409);}const statements=[];
    if(backup.resource_type==='student_deletion'){
      for(const student of data.students||[])statements.push(db.prepare('INSERT OR IGNORE INTO students(id,full_name,group_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(student.id,student.full_name,student.group_id,student.active,student.created_at,student.updated_at));
      for(const row of data.attendance||[])statements.push(db.prepare('INSERT OR IGNORE INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by,updated_at) VALUES(?,?,?,?,?,?,?)').bind(row.id,row.session_id,row.student_key,row.student_name_snapshot||'',row.status,row.recorded_by,row.updated_at));
    }else if(backup.resource_type==='attendance_deletion'){
      for(const row of data.attendance||[]){const student=row.student_key?await db.prepare('SELECT 1 FROM students WHERE id=?').bind(row.student_key).first():null;statements.push(db.prepare('INSERT OR IGNORE INTO attendance(id,session_id,student_key,student_name_snapshot,status,recorded_by,updated_at) VALUES(?,?,?,?,?,?,?)').bind(row.id,row.session_id,student?row.student_key:null,row.student_name_snapshot||'',row.status,row.recorded_by,row.updated_at));}
    }else if(backup.resource_type==='session_archive')statements.push(db.prepare('UPDATE sessions SET active=1 WHERE id=?').bind(backup.resource_id));
    else if(backup.resource_type==='group_archive')statements.push(db.prepare('UPDATE groups SET active=1 WHERE id=?').bind(backup.resource_id));
    else if(backup.resource_type==='course_archive')statements.push(db.prepare('UPDATE courses SET active=1 WHERE id=?').bind(backup.resource_id));
    else return fail('This backup type cannot be restored.',409);
    if(statements.length)await db.batch(statements);await audit(db,user,'restored','backup',backup.id,{resource_type:backup.resource_type,record_count:backup.record_count});return json({ok:true,resource_type:backup.resource_type});
  }
  if(method==='GET'&&path==='/api/profile')return json({user,theme:user.theme});
  if(method==='PUT'&&path==='/api/profile/theme'){
    const x=await body(req);if(!['light','dark','system'].includes(x?.theme))return fail('Choose Light, Dark, or System appearance.');await db.prepare('INSERT INTO user_preferences(user_id,theme) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,updated_at=CURRENT_TIMESTAMP').bind(user.id,x.theme).run();await audit(db,user,'changed appearance','user',user.id,{theme:x.theme});return json({theme:x.theme});
  }
  if(method==='GET'&&path==='/api/audit'){
    if(requireCapability(user,'audit_logs.read'))return requireCapability(user,'audit_logs.read');const filters={user:cleanText(url.searchParams.get('user'),80),action:cleanText(url.searchParams.get('action'),80),resource:cleanText(url.searchParams.get('resource'),80),from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||''};if(filters.from&&!validDate(filters.from)||filters.to&&!validDate(filters.to))return fail('Choose valid start and end dates.');let limit=Number(url.searchParams.get('limit')||50),offset=Number(url.searchParams.get('offset')||0);limit=Math.min(100,Math.max(1,Number.isInteger(limit)?limit:50));offset=Math.max(0,Number.isInteger(offset)?offset:0);const where=['1=1'],bind=[];for(const[key,column]of[['user','a.actor_id=?'],['action','a.action=?'],['resource','a.entity_type=?']])if(filters[key]){where.push(column);bind.push(filters[key]);}if(filters.from){where.push("date(a.created_at)>=date(?)");bind.push(filters.from);}if(filters.to){where.push("date(a.created_at)<=date(?)");bind.push(filters.to);}const clause=where.join(' AND '),total=await db.prepare(`SELECT COUNT(*) total FROM audit_logs a WHERE ${clause}`).bind(...bind).first(),items=await db.prepare(`SELECT a.id,a.actor_id,a.action,a.entity_type,a.entity_id,a.details,a.created_at,u.full_name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${clause} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).bind(...bind,limit,offset).all();return json({items:(items.results||[]).map(item=>({...item,details:safeAuditDetails(item.details)})),total:total?.total||0,limit,offset,filters});
  }
  return fail('Not found.',404);
}

export default {
  async fetch(req, env, ctx) {
    try {
      const url=new URL(req.url);
      if(url.pathname.startsWith('/api/')) {
        const response=await safeRoute(req,env,ctx),headers=new Headers(response.headers);
        headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','same-origin');headers.set('x-frame-options','DENY');headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');headers.set('cache-control','no-store');
        return new Response(response.body,{status:response.status,headers});
      }
      const response=await env.ASSETS.fetch(req);
      const headers=new Headers(response.headers);
      headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','same-origin');headers.set('x-frame-options','DENY');headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
      headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
      if(url.protocol==='https:')headers.set('strict-transport-security','max-age=31536000; includeSubDomains');
      return new Response(response.body,{status:response.status,headers});
    } catch (error) {
    console.error('Request failed',error instanceof Error?error.name:'unknown');
      return req.url.includes('/api/')?fail('The request could not be completed. Please try again.',500):new Response('The application is temporarily unavailable.',{status:500});
    }
  }
};
