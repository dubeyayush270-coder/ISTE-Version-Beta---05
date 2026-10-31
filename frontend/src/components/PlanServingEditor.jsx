import { useEffect, useState } from 'react';
import { CalendarDays, UsersRound, AlertTriangle } from 'lucide-react';
import { api, num } from '../lib/api';
import {
  isAttendanceControlled,
  mealAttendanceLabel,
  previewMealEaters,
} from '../lib/planServingLogic.js';

/**
 * The meal-plan database stores 1..30 saved eaters as a reversible fallback.
 * This editor only previews family attendance; the backend remains the source
 * of truth for live effective servings, shopping and stock deduction.
 */
export default function PlanServingEditor({
  day, mealType, savedEaters, onSavedEatersChange,
  recipe, onManageAttendance,
}) {
  const [request, setRequest] = useState(0);
  const [state, setState] = useState({ loading: true, info: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, info: null, error: '' });
    api(`/family/attendance/${day}/${mealType}`)
      .then(info => {
        if (!cancelled) setState({ loading: false, info, error: '' });
      })
      .catch(err => {
        if (!cancelled) setState({ loading: false, info: null, error: err.message || 'Attendance unavailable' });
      });
    return () => { cancelled = true; };
  }, [day, mealType, request]);

  const controlled = isAttendanceControlled(state.info);
  const effective = state.info ? previewMealEaters(savedEaters, state.info) : null;
  const calorieTotal = effective !== null && recipe ? num(recipe.calories_per_serving * effective) : null;

  return <div className="space-y-3">
    {state.loading ? (
      <p className="text-sm rounded-xl px-4 py-3 bg-[#eff6ef] text-[#426b51]" role="status">Checking family attendance…</p>
    ) : state.error ? (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
        <div className="flex gap-2"><AlertTriangle size={18} className="shrink-0" /> Can't confirm whether family attendance is active. The saved meal count is unchanged.</div>
        <button className="underline font-semibold mt-2" type="button" onClick={() => setRequest(n => n + 1)}>Retry</button>
      </div>
    ) : controlled ? (
      <div className="rounded-xl bg-[#e9f5ed] border border-[#bfe3c9] p-4" role="status">
        <div className="flex gap-2 items-center text-[#236c48] font-bold"><UsersRound size={19} /> Family attendance controls this meal</div>
        <p className="text-2xl font-bold text-[#205d41] mt-2">{effective === null ? 'Attendance unavailable' : mealAttendanceLabel(effective)}</p>
        <p className="text-sm text-[#50745c] mt-1">Ingredient quantities and shopping shortages use this attendance count, not the saved backup count.</p>
        {effective === 0 && <p className="text-sm font-semibold text-[#9b5d29] mt-2">No ingredients needed. Add an attendee before marking this meal cooked.</p>}
        <button className="mt-3 min-h-11 rounded-xl bg-white border border-[#afd7b8] px-4 py-2 text-sm font-bold text-[#246949] inline-flex items-center gap-2" type="button" onClick={onManageAttendance}><CalendarDays size={16} /> Edit who is eating</button>
        <p className="mt-3 text-xs text-[#6c8a74]">Saved backup: {savedEaters} {Number(savedEaters) === 1 ? 'person' : 'people'}. Used if family attendance is turned off.</p>
      </div>
    ) : (
      <div>
        <label className="k-label" htmlFor="ks-plan-saved-servings">People eating this meal</label>
        <input id="ks-plan-saved-servings" type="number" className="k-field" min="1" max="30" required value={savedEaters} onChange={e => onSavedEatersChange(e.target.value)} />
        <p className="text-xs text-[#6b8571] mt-2">Using the manually saved serving count. To choose individual attendees, turn on attendance-based servings in Family Management.</p>
        <button type="button" className="mt-2 min-h-10 text-sm font-semibold text-[#267550] underline" onClick={onManageAttendance}>Manage family attendance</button>
      </div>
    )}
    {recipe && <div className="bg-[#f3f8f1] rounded-xl p-4 text-sm" aria-live="polite">
      <div className="flex justify-between items-center gap-3"><strong>Estimated total calories</strong><strong>{calorieTotal === null ? 'Checking…' : `~${calorieTotal} kcal`}</strong></div>
      <p className="text-xs text-[#829486] mt-2">{controlled ? 'Based on attending family members.' : 'Based on manually saved servings.'} Sample estimate; ingredient amounts scale automatically.</p>
    </div>}
  </div>;
}
