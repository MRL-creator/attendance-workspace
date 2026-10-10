PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','instructor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)));

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, course_id TEXT REFERENCES courses(id));

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instructor_assignments (
  id TEXT PRIMARY KEY,
  instructor_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  UNIQUE(instructor_id, course_id, group_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  instructor_id TEXT NOT NULL REFERENCES users(id),
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 1 AND 600),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, end_time TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  imported_by TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started INTEGER NOT NULL
);

CREATE TABLE roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY(role_code, permission_code)
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  assigned_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, role_code)
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "attendance" (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  student_key TEXT REFERENCES students(id) ON DELETE SET NULL,
  student_name_snapshot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('present','absent')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id,student_key)
);

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,permission_code)
);

CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  record_count INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspace_settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100));

INSERT INTO permissions VALUES('users.read','View staff accounts');

INSERT INTO permissions VALUES('users.create','Create staff accounts');

INSERT INTO permissions VALUES('users.update','Update staff accounts');

INSERT INTO permissions VALUES('users.disable','Disable staff accounts');

INSERT INTO permissions VALUES('users.delete','Delete staff accounts');

INSERT INTO permissions VALUES('students.read','View student records');

INSERT INTO permissions VALUES('students.create','Create student records');

INSERT INTO permissions VALUES('students.update','Update student records');

INSERT INTO permissions VALUES('students.import','Import student records');

INSERT INTO permissions VALUES('students.export','Export student records');

INSERT INTO permissions VALUES('groups.read','View groups');

INSERT INTO permissions VALUES('groups.create','Create groups');

INSERT INTO permissions VALUES('groups.update','Update groups');

INSERT INTO permissions VALUES('groups.delete','Delete groups');

INSERT INTO permissions VALUES('courses.read','View courses');

INSERT INTO permissions VALUES('courses.create','Create courses');

INSERT INTO permissions VALUES('courses.update','Update courses');

INSERT INTO permissions VALUES('courses.delete','Delete courses');

INSERT INTO permissions VALUES('assignments.read','View instructor assignments');

INSERT INTO permissions VALUES('assignments.create','Create instructor assignments');

INSERT INTO permissions VALUES('assignments.update','Update instructor assignments');

INSERT INTO permissions VALUES('assignments.delete','Delete instructor assignments');

INSERT INTO permissions VALUES('sessions.read','View attendance sessions');

INSERT INTO permissions VALUES('sessions.create','Create attendance sessions');

INSERT INTO permissions VALUES('sessions.update','Update attendance sessions');

INSERT INTO permissions VALUES('sessions.delete','Delete attendance sessions');

INSERT INTO permissions VALUES('attendance.read','View attendance records');

INSERT INTO permissions VALUES('attendance.create','Record attendance');

INSERT INTO permissions VALUES('attendance.update','Correct attendance');

INSERT INTO permissions VALUES('attendance.delete','Delete attendance records');

INSERT INTO permissions VALUES('reports.read','View attendance reports');

INSERT INTO permissions VALUES('reports.export','Export attendance reports');

INSERT INTO permissions VALUES('settings.manage','Manage system settings');

INSERT INTO permissions VALUES('audit_logs.read','View audit history');

INSERT INTO permissions VALUES('roles.manage','Manage account roles');

INSERT INTO permissions VALUES('super_admin.manage','Manage super administrator privileges');

INSERT INTO permissions VALUES('students.delete','Delete selected student records while preserving attendance history');

INSERT INTO permissions VALUES('backups.manage','View and restore administrative backups');

INSERT INTO roles VALUES('super_admin','Super administrator');

INSERT INTO roles VALUES('admin','Administrator');

INSERT INTO roles VALUES('instructor','Instructor');

INSERT INTO roles VALUES('viewer','Viewer');

INSERT INTO role_permissions VALUES('super_admin','assignments.create');

INSERT INTO role_permissions VALUES('super_admin','assignments.delete');

INSERT INTO role_permissions VALUES('super_admin','assignments.read');

INSERT INTO role_permissions VALUES('super_admin','assignments.update');

INSERT INTO role_permissions VALUES('super_admin','attendance.create');

INSERT INTO role_permissions VALUES('super_admin','attendance.delete');

INSERT INTO role_permissions VALUES('super_admin','attendance.read');

INSERT INTO role_permissions VALUES('super_admin','attendance.update');

INSERT INTO role_permissions VALUES('super_admin','audit_logs.read');

INSERT INTO role_permissions VALUES('super_admin','courses.create');

INSERT INTO role_permissions VALUES('super_admin','courses.delete');

INSERT INTO role_permissions VALUES('super_admin','courses.read');

INSERT INTO role_permissions VALUES('super_admin','courses.update');

INSERT INTO role_permissions VALUES('super_admin','groups.create');

INSERT INTO role_permissions VALUES('super_admin','groups.delete');

INSERT INTO role_permissions VALUES('super_admin','groups.read');

INSERT INTO role_permissions VALUES('super_admin','groups.update');

INSERT INTO role_permissions VALUES('super_admin','reports.export');

INSERT INTO role_permissions VALUES('super_admin','reports.read');

INSERT INTO role_permissions VALUES('super_admin','roles.manage');

INSERT INTO role_permissions VALUES('super_admin','sessions.create');

INSERT INTO role_permissions VALUES('super_admin','sessions.delete');

INSERT INTO role_permissions VALUES('super_admin','sessions.read');

INSERT INTO role_permissions VALUES('super_admin','sessions.update');

INSERT INTO role_permissions VALUES('super_admin','settings.manage');

INSERT INTO role_permissions VALUES('super_admin','students.create');

INSERT INTO role_permissions VALUES('super_admin','students.export');

INSERT INTO role_permissions VALUES('super_admin','students.import');

INSERT INTO role_permissions VALUES('super_admin','students.read');

INSERT INTO role_permissions VALUES('super_admin','students.update');

INSERT INTO role_permissions VALUES('super_admin','super_admin.manage');

INSERT INTO role_permissions VALUES('super_admin','users.create');

INSERT INTO role_permissions VALUES('super_admin','users.delete');

INSERT INTO role_permissions VALUES('super_admin','users.disable');

INSERT INTO role_permissions VALUES('super_admin','users.read');

INSERT INTO role_permissions VALUES('super_admin','users.update');

INSERT INTO role_permissions VALUES('admin','users.read');

INSERT INTO role_permissions VALUES('admin','users.create');

INSERT INTO role_permissions VALUES('admin','users.update');

INSERT INTO role_permissions VALUES('admin','users.disable');

INSERT INTO role_permissions VALUES('admin','students.read');

INSERT INTO role_permissions VALUES('admin','students.create');

INSERT INTO role_permissions VALUES('admin','students.update');

INSERT INTO role_permissions VALUES('admin','students.import');

INSERT INTO role_permissions VALUES('admin','students.export');

INSERT INTO role_permissions VALUES('admin','groups.read');

INSERT INTO role_permissions VALUES('admin','groups.create');

INSERT INTO role_permissions VALUES('admin','groups.update');

INSERT INTO role_permissions VALUES('admin','groups.delete');

INSERT INTO role_permissions VALUES('admin','courses.read');

INSERT INTO role_permissions VALUES('admin','courses.create');

INSERT INTO role_permissions VALUES('admin','courses.update');

INSERT INTO role_permissions VALUES('admin','courses.delete');

INSERT INTO role_permissions VALUES('admin','assignments.read');

INSERT INTO role_permissions VALUES('admin','assignments.create');

INSERT INTO role_permissions VALUES('admin','assignments.update');

INSERT INTO role_permissions VALUES('admin','assignments.delete');

INSERT INTO role_permissions VALUES('admin','sessions.read');

INSERT INTO role_permissions VALUES('admin','sessions.create');

INSERT INTO role_permissions VALUES('admin','sessions.update');

INSERT INTO role_permissions VALUES('admin','sessions.delete');

INSERT INTO role_permissions VALUES('admin','attendance.read');

INSERT INTO role_permissions VALUES('admin','attendance.create');

INSERT INTO role_permissions VALUES('admin','attendance.update');

INSERT INTO role_permissions VALUES('admin','attendance.delete');

INSERT INTO role_permissions VALUES('admin','reports.read');

INSERT INTO role_permissions VALUES('admin','reports.export');

INSERT INTO role_permissions VALUES('admin','settings.manage');

INSERT INTO role_permissions VALUES('admin','audit_logs.read');

INSERT INTO role_permissions VALUES('instructor','students.read');

INSERT INTO role_permissions VALUES('instructor','groups.read');

INSERT INTO role_permissions VALUES('instructor','courses.read');

INSERT INTO role_permissions VALUES('instructor','sessions.read');

INSERT INTO role_permissions VALUES('instructor','sessions.create');

INSERT INTO role_permissions VALUES('instructor','attendance.read');

INSERT INTO role_permissions VALUES('instructor','attendance.create');

INSERT INTO role_permissions VALUES('instructor','attendance.update');

INSERT INTO role_permissions VALUES('instructor','reports.read');

INSERT INTO role_permissions VALUES('viewer','students.read');

INSERT INTO role_permissions VALUES('viewer','groups.read');

INSERT INTO role_permissions VALUES('viewer','courses.read');

INSERT INTO role_permissions VALUES('viewer','sessions.read');

INSERT INTO role_permissions VALUES('viewer','attendance.read');

INSERT INTO role_permissions VALUES('viewer','reports.read');

INSERT INTO role_permissions VALUES('instructor','sessions.update');

INSERT INTO role_permissions VALUES('admin','students.delete');

INSERT INTO role_permissions VALUES('admin','backups.manage');

INSERT INTO role_permissions VALUES('super_admin','backups.manage');

CREATE INDEX assignments_instructor_idx ON instructor_assignments(instructor_id);

CREATE INDEX attendance_student_idx ON attendance(student_key,session_id);

CREATE INDEX audit_actor_idx ON audit_logs(actor_id,created_at DESC);

CREATE INDEX audit_created_idx ON audit_logs(created_at DESC);

CREATE INDEX audit_resource_idx ON audit_logs(entity_type,created_at DESC);

CREATE INDEX auth_expiry_idx ON auth_sessions(expires_at);

CREATE INDEX backups_created_idx ON backups(created_at DESC);

CREATE INDEX groups_course_idx ON groups(course_id,active);

CREATE INDEX sessions_course_group_date_idx ON sessions(course_id,group_id,session_date DESC);

CREATE INDEX sessions_date_idx ON sessions(session_date DESC);

CREATE INDEX sessions_group_idx ON sessions(group_id, session_date DESC);

CREATE INDEX students_group_idx ON students(group_id,active);

CREATE INDEX students_name_idx ON students(full_name COLLATE NOCASE);

CREATE INDEX user_permissions_user_idx ON user_permissions(user_id,permission_code);

CREATE INDEX user_roles_role_idx ON user_roles(role_code, user_id);
