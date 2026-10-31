export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {'Content-Type': 'application/json', ...(options.headers ?? {})},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    let message = typeof detail === 'string' ? detail : detail?.message || 'Request failed';
    if (Array.isArray(detail?.missing)) message += ': ' + detail.missing.join(', ');
    if (Array.isArray(detail)) message = detail.map(e => e.msg).join('; ');
    throw new Error(message);
  }
  return data;
}

export function dateISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export const todayISO = () => dateISO(new Date());
export function monday(date = new Date()) {
  const d = new Date(date); d.setHours(12,0,0,0);
  d.setDate(d.getDate() - (d.getDay()+6)%7);
  return d;
}
export function addDays(date, count) {
  const d = new Date(date); d.setDate(d.getDate() + count); return d;
}
export function prettyDate(iso, options = {weekday:'short', day:'numeric', month:'short'}) {
  return new Date(iso+'T12:00:00').toLocaleDateString('en-IN',options);
}
export const num = value => Number(Number(value || 0).toFixed(2)).toLocaleString('en-IN');
export const displayAmount = (qty,unit) => `${num(qty)} ${unit}`;
export function scaleRecipe(recipe, eaters) {
  return recipe.ingredients.map(([name, quantity, unit]) => ({
    name,
    quantity: Math.round(
      (quantity * eaters / recipe.base_servings) * 100
    ) / 100,
    unit
  }));
}

export const recipeIcon = recipe => /poha|upma/i.test(recipe?.name||'')?'🥣':/paratha|roti/i.test(recipe?.name||'')?'🫓':/rice|pulao/i.test(recipe?.name||'')?'🍚':/paneer/i.test(recipe?.name||'')?'🧀':'🍛';
