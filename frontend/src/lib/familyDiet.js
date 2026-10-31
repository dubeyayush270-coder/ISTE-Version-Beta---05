export const DIETARY_OPTIONS = Object.freeze([
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'non-vegetarian', label: 'Non-Vegetarian' },
  { value: 'eggitarian', label: 'Eggitarian' },
  { value: 'vegan', label: 'Vegan' },
]);

// Backward-compatible display of a member saved before the database upgrade.
export function preferenceOf(member) {
  const value = member?.dietary_preference;
  if (DIETARY_OPTIONS.some(option => option.value === value)) return value;
  return member?.vegetarian ? 'vegetarian' : 'non-vegetarian';
}

export function dietaryLabel(value) {
  return DIETARY_OPTIONS.find(option => option.value === value)?.label ?? 'Non-Vegetarian';
}
