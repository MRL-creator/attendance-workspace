export function canAssignSessionInstructor({ active, instructorRole, adminOverride, assigned }) {
  return Boolean(active && instructorRole && (adminOverride || assigned));
}
