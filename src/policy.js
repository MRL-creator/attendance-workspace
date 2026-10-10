export function hasRole(user, role) {
  return Boolean(user?.roles?.includes(role) || user?.role === role);
}

export function can(user, permission) {
  return Boolean(user?.permissions?.includes(permission) || hasRole(user, 'super_admin'));
}

export function isAdmin(user) {
  return hasRole(user, 'admin') || hasRole(user, 'super_admin');
}

export function isViewer(user) {
  return hasRole(user, 'viewer');
}
