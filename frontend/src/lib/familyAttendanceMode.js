/** A named active family member is required before switching to attendance-based servings. */
export function canEnableFamilyAttendance(members) {
  return Array.isArray(members) && members.some(member => member.enabled === true);
}

/** Compare two saved checkbox selections without depending on their display order. */
export function sameAttendees(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === a.length && b.every(id => left.has(id));
}
