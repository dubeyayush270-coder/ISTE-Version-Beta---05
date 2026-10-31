// Keep the stored backup serving count distinct from the effective family attendance.
// The backend's /plan response includes saved_eaters even when eaters becomes zero.
export function savedPlanEaters(meal, fallback = 2) {
  const candidate = meal?.saved_eaters ?? meal?.eaters ?? fallback;
  const count = Number(candidate);
  const saneFallback = Number(fallback);
  if (Number.isInteger(count) && count >= 1 && count <= 30) return count;
  return Number.isInteger(saneFallback) && saneFallback >= 1 && saneFallback <= 30 ? saneFallback : 2;
}

export function isAttendanceControlled(info) {
  return info?.attendance_enabled === true;
}

export function previewMealEaters(savedEaters, info) {
  if (!isAttendanceControlled(info)) return savedPlanEaters({ saved_eaters: savedEaters });
  const count = Number(info.roster_eaters);
  return Number.isInteger(count) && count >= 0 && count <= 30 ? count : null;
}

export function mealAttendanceLabel(eaters) {
  return eaters === 0 ? 'No one attending' : `${eaters} ${eaters === 1 ? 'person' : 'people'} attending`;
}
