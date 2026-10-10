// Default to ordinary email addresses; installers may restrict domains explicitly.
export function validAccountEmail(email, allowedDomains = '') {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const domains = String(allowedDomains).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return !domains.length || domains.includes(email.split('@')[1].toLowerCase());
}
