// A convenience selection for this device, not user authentication.
// This module intentionally does not modify family attendance or servings.
export const ACTIVE_FAMILY_PROFILE_KEY = 'kitchensync.activeFamilyProfile.v1';

export function resolveActiveFamilyProfile(members, rawId) {
  if (rawId === null || rawId === undefined || rawId === '') return null;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1 || String(id) !== String(rawId)) return null;
  return (Array.isArray(members) ? members : []).find(
    member => member.id === id && member.enabled === true
  ) ?? null;
}

export function readActiveFamilyProfileId(storage) {
  try {
    const saved = storage?.getItem(ACTIVE_FAMILY_PROFILE_KEY);
    if (!saved || !/^[1-9]\d*$/.test(saved)) return null;
    const id = Number(saved);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null; // Storage may be blocked in private browsing.
  }
}

export function saveActiveFamilyProfileId(storage, id) {
  if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return false;
  try {
    if (!storage) return false;
    if (id === null) storage.removeItem(ACTIVE_FAMILY_PROFILE_KEY);
    else storage.setItem(ACTIVE_FAMILY_PROFILE_KEY, String(id));
    return true;
  } catch {
    return false;
  }
}
