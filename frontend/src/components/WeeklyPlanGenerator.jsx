import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Globe2, LoaderCircle, LockKeyhole, LockKeyholeOpen, Pencil, RefreshCw, Sparkles, UsersRound, X } from 'lucide-react';
import { api, prettyDate } from '../lib/api';
import OnlineRecipeDiscovery from './OnlineRecipeDiscovery.jsx';
import './WeeklyPlanGenerator.css';

const TYPES = ['breakfast', 'lunch', 'dinner'];
const ICONS = { breakfast: '🥣', lunch: '🍛', dinner: '🍲' };
const payloadMeals = meals => meals.map(({ meal_date, meal_type, recipe_id, eaters }) =>
  ({ meal_date, meal_type, recipe_id, eaters }));

/** Live preview totals: per serving, never multiplied by household headcount. */
function previewNutrition(meals) {
  const days = [...new Set(meals.map(m => m.meal_date))];
  const keys = ['calories', 'protein_g', 'carbs_g', 'fat_g'];
  return days.map(day => {
    const rows = meals.filter(m => m.meal_date === day);
    const totals = Object.fromEntries(keys.map(key => {
      const values = rows.map(row => row.nutrition?.[key]);
      return [key, values.every(value => value != null && Number.isFinite(Number(value)))
        ? Math.round(values.reduce((sum,value) => sum + Number(value), 0)*10)/10 : null];
    }));
    return {date: day, per_person_if_attending_all: totals,
      known_meals: rows.filter(m => m.nutrition?.calories != null).length};
  });
}

export default function WeeklyPlanGenerator({ start, householdSize, onSaved, onNotify }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="kswg-launch">
      <div><span className="kswg-eyebrow">A LITTLE LESS PLANNING</span><h2>Your week, thoughtfully planned</h2>
        <p>Plan from saved recipes and reviewed online discoveries. You choose the final menu.</p></div>
      <button type="button" className="kswg-primary" onClick={() => setOpen(true)}>
        <Sparkles size={18} aria-hidden="true" /> Generate My Week
      </button>
    </div>
    {open && <WeekPreview key={start} start={start} householdSize={householdSize}
      onClose={() => setOpen(false)} onSaved={onSaved} onNotify={onNotify} />}
  </>;
}

function WeekPreview({ start, householdSize, onClose, onSaved, onNotify }) {
  const [preview, setPreview] = useState(null);
  const [foodType, setFoodType] = useState('any');
  const [exclude, setExclude] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [nutritionGoal, setNutritionGoal] = useState('balanced');
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState('');
  const [weekdayMinutes, setWeekdayMinutes] = useState('');
  const [weekendMinutes, setWeekendMinutes] = useState('');
  const [weeklyBudget, setWeeklyBudget] = useState('');
  const [userLocks, setUserLocks] = useState({});
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState('generate');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [savedRecipes, setSavedRecipes] = useState([]);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineTarget, setOnlineTarget] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [customized, setCustomized] = useState(false);
  const sequence = useRef(0);
  const controller = useRef(null);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const saving = working === 'save';
  const preferences = () => ({ food_type: foodType,
    exclude: exclude.split(',').map(value => value.trim()).filter(Boolean),
    max_minutes: maxMinutes === '' ? null : Number(maxMinutes),
    weekday_minutes: weekdayMinutes === '' ? null : Number(weekdayMinutes),
    weekend_minutes: weekendMinutes === '' ? null : Number(weekendMinutes),
    nutrition_goal: nutritionGoal,
    daily_calorie_target: dailyCalorieTarget === '' ? null : Number(dailyCalorieTarget),
    weekly_budget: weeklyBudget === '' ? null : Number(weeklyBudget),
  });

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      controller.current?.abort();
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    loadSavedRecipes();
    generate();
    // The modal's start-date key creates one initial request per selected week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (onlineOpen && onlineTarget) {
      document.querySelector('.kswg-online')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [onlineOpen, onlineTarget]);

  function focusTrap(event) {
    if (event.key === 'Escape' && !saving) { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button,input,select,textarea,a[href]')]
      .filter(element => !element.matches(':disabled') && element.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function loadSavedRecipes() {
    try {
      const recipes = await api('/recipes');
      setSavedRecipes(Array.isArray(recipes) ? recipes : []);
      return Array.isArray(recipes) ? recipes : [];
    } catch (err) {
      setError(`Could not load saved recipes: ${err.message}`);
      return [];
    }
  }

  function chooseSaved(meal, recipeId, providedRecipes = savedRecipes) {
    if (meal.locked || saved || working) return;
    const candidate = providedRecipes.find(recipe => Number(recipe.id) === Number(recipeId));
    if (!candidate || candidate.category.toLowerCase() !== meal.meal_type.toLowerCase()) {
      setError('Choose a saved recipe for the matching meal type.');
      return;
    }
    setPreview(current => ({ ...current, meals: current.meals.map(row =>
      row.meal_date === meal.meal_date && row.meal_type === meal.meal_type
        ? { ...row, recipe_id: candidate.id, recipe_name: candidate.name,
            minutes: candidate.minutes, category: candidate.category,
            why: null,
            nutrition: {calories: candidate.calories_per_serving > 0 ? Number(candidate.calories_per_serving) : null,
              protein_g: candidate.protein_g_per_serving, carbs_g: candidate.carbs_g_per_serving,
              fat_g: candidate.fat_g_per_serving, source: candidate.nutrition_source || 'unknown'} } : row),
    }));
    setCustomized(true); setConfirmed(false); setError('');
  }

  async function importedOnlineRecipe(result) {
    const refreshed = await loadSavedRecipes();
    if (onlineTarget && preview) {
      chooseSaved(onlineTarget, result.recipe_id, refreshed);
    } else {
      setCustomized(true);
      setConfirmed(false);
    }
    setOnlineOpen(false); setOnlineTarget(null); setEditingKey(null);
    onNotify?.('Online recipe imported. Review your week, then save or regenerate.');
  }

  async function saveNutrition(recipeId, values) {
    await api(`/recipes/${recipeId}/nutrition`, {method:'PUT', body: JSON.stringify(values)});
    const refreshed = await loadSavedRecipes();
    const record = refreshed.find(item => Number(item.id) === Number(recipeId));
    if (record) {
      setPreview(old => old ? ({...old, meals: old.meals.map(m =>
        Number(m.recipe_id) === Number(recipeId)
          ? {...m, nutrition: {
            calories: record.calories_per_serving > 0 ? Number(record.calories_per_serving) : null,
            protein_g: record.protein_g_per_serving,
            carbs_g: record.carbs_g_per_serving,
            fat_g: record.fat_g_per_serving,
            source: record.nutrition_source,
          }} : m),
        daily_nutrition: null}) : old);
    }
    onNotify?.('Recipe nutrition saved. Regenerate to apply the updated nutrition ranking.');
  }

  async function regenerateUnlocked() {
    if (!preview || dirty || working || saved) return;
    const active = new AbortController();
    controller.current?.abort(); controller.current = active;
    setWorking('generate'); setError(''); setConfirmed(false);
    try {
      const locked_slots = preview.meals.filter(m => userLocks[`${m.meal_date}-${m.meal_type}`])
        .map(({meal_date,meal_type}) => ({meal_date,meal_type}));
      const result = await api('/plan/suggestions/regenerate', {method:'POST', signal: active.signal,
        body: JSON.stringify({start, preferences:preferences(), seed:++sequence.current,
          expected_version:preview.expected_version, meals:payloadMeals(preview.meals), locked_slots})});
      if (!active.signal.aborted) {
        setPreview(result); setCustomized(false); setEditingKey(null);
      }
    } catch(err) { if (!active.signal.aborted) setError(err.message || 'Regeneration failed. Previous preview retained.'); }
    finally { if (!active.signal.aborted) setWorking(''); }
  }

  function changed(setter, value) {
    setter(value); setDirty(true); setConfirmed(false); setError('');
  }

  async function generate() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const seed = ++sequence.current;
    setWorking('generate'); setError(''); setConfirmed(false);
    try {
      const result = await api('/plan/suggestions', { method: 'POST', signal: active.signal,
        body: JSON.stringify({ start, preferences: preferences(), seed }) });
      if (active.signal.aborted) return;
      setPreview(result); setDirty(false); setCustomized(false); setEditingKey(null); setUserLocks({});
    } catch (err) {
      if (!active.signal.aborted) { setError(err.message || 'Could not generate this week. Try again.'); setDirty(true); }
    } finally { if (!active.signal.aborted) setWorking(''); }
  }

  async function replace(meal) {
    const active = new AbortController(); controller.current = active;
    setWorking(`${meal.meal_date}-${meal.meal_type}`); setError(''); setConfirmed(false);
    try {
      const result = await api('/plan/suggestions/replace', { method: 'POST', signal: active.signal,
        body: JSON.stringify({ start, preferences: preferences(), seed: ++sequence.current,
          expected_version: preview.expected_version, meals: payloadMeals(preview.meals),
          target_date: meal.meal_date, target_type: meal.meal_type }) });
      if (!active.signal.aborted) setPreview(current => ({ ...current, ...result }));
    } catch (err) {
      if (!active.signal.aborted) setError(`${err.message || 'Could not replace this meal.'} Your preview has not changed.`);
    } finally { if (!active.signal.aborted) setWorking(''); }
  }

  async function save(event) {
    event.preventDefault();
    if (!confirmed || dirty || working || !preview || saved) return;
    setWorking('save'); setError('');
    try {
      const result = await api('/plan/week', { method: 'PUT', body: JSON.stringify({ start,
        preferences: preferences(), expected_version: preview.expected_version,
        meals: payloadMeals(preview.meals), confirmed: true, replace_existing: true }) });
      setSaved(result); setConfirmed(false);
      try {
        const refreshed = await onSaved?.();
        if (refreshed === false) setRefreshFailed(true);
      } catch { setRefreshFailed(true); }
      onNotify?.('Weekly plan saved. Ingredient requirements and Shopping have been recalculated.');
    } catch (err) {
      setError(`${err.message || 'Could not save this week.'} If the connection was interrupted, refresh to check whether the week was saved before trying again.`);
      setConfirmed(false);
    } finally { setWorking(''); }
  }

  const days = [...new Set(preview?.meals.map(meal => meal.meal_date) || [])];
  const locked = preview?.meals.filter(meal => meal.locked).length || 0;
  const pinned = Object.values(userLocks).filter(Boolean).length;
  const fmt = (value, unit = '') => value == null || !Number.isFinite(Number(value))
    ? '—' : `${Number(value).toLocaleString('en-IN', {maximumFractionDigits: 1})}${unit}`;

  return <div className="kswg-backdrop" onKeyDown={focusTrap}>
    <section ref={dialog} className="kswg-dialog" role="dialog" aria-modal="true" aria-labelledby="kswg-title" aria-describedby="kswg-description">
      <header className="kswg-header">
        <div><span className="kswg-eyebrow">SMART AUTOMATED PLANNING</span><h2 id="kswg-title">Your suggested week <span aria-hidden="true">🌿</span></h2>
          <p id="kswg-description">{prettyDate(start)} · 7 days · 21 meals · {preview?.attendance_enabled ? 'Family attendance determines servings' : `${preview?.household_size || householdSize} people by default`}</p></div>
        <button ref={closeButton} type="button" className="kswg-icon-button" disabled={saving} onClick={onClose} aria-label="Close weekly suggestions"><X size={22} /></button>
      </header>
      <div className="kswg-body" aria-busy={Boolean(working)}>
        <p className="kswg-explainer">Saved + Online: suggestions use your saved recipe library (including online recipes you have reviewed and imported), existing Pantry stock and family attendance. You can edit any uncooked meal before confirming. No imaginary future leftovers are created.</p>
        {!saved && <fieldset className="kswg-preferences" disabled={Boolean(working)}>
          <legend>Plan preferences</legend>
          <label>Food preference<select value={foodType} onChange={event => changed(setFoodType, event.target.value)}>
            <option value="any">Any recipe</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="vegan">Vegan</option>
            <option value="non-vegetarian">Non-vegetarian</option>
            <option value="eggitarian">Eggetarian</option>
          </select></label>
          <label>Maximum cooking time<select value={maxMinutes} onChange={event => changed(setMaxMinutes, event.target.value)}>
            <option value="">Any time</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option>
          </select></label>
          <label>Nutrition priority
            <select value={nutritionGoal} onChange={event => changed(setNutritionGoal, event.target.value)}>
              <option value="balanced">Balanced & varied</option>
              <option value="high_protein">High protein</option>
              <option value="calorie_aware">My calorie target</option>
            </select>
          </label>
          {nutritionGoal === 'calorie_aware' && <label>Daily calorie target per person (kcal)
            <input type="number" min="800" max="5000" step="50" placeholder="e.g. 2000" value={dailyCalorieTarget}
              onChange={event => changed(setDailyCalorieTarget, event.target.value)} />
          </label>}
          <label>Weekday cooking limit
            <select value={weekdayMinutes} onChange={event => changed(setWeekdayMinutes, event.target.value)}>
              <option value="">Use general limit</option><option value="15">15 min</option>
              <option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option>
            </select>
          </label>
          <label>Weekend cooking limit
            <select value={weekendMinutes} onChange={event => changed(setWeekendMinutes, event.target.value)}>
              <option value="">Use general limit</option><option value="30">30 min</option>
              <option value="60">60 min</option><option value="90">90 min</option>
            </select>
          </label>
          <label>Weekly grocery budget (₹, optional)
            <input type="number" min="1" step="50" placeholder="Not enforced without prices"
              value={weeklyBudget} onChange={event => changed(setWeeklyBudget, event.target.value)} />
          </label>
          <p className="kswg-wide kswg-help">Nutrition is per serving and may be illustrative, user-entered, or unavailable. A budget cannot be guaranteed until verified ingredient prices are available. Family attendance controls how much is cooked.</p>
          <label className="kswg-wide">Exclude ingredients<input value={exclude} maxLength={500} placeholder="e.g. peanuts, onion" onChange={event => changed(setExclude, event.target.value)} />
            <small>Comma-separated; checked against recorded ingredients and supported aliases.</small></label>
        </fieldset>}
        {!saved && <div className="kswg-source-row">
          <div><strong>Recipe source: Saved + Online</strong><p>Discover online recipes, verify ingredient amounts and add them to your library for this week's suggestions.</p></div>
          <button type="button" className="kswg-secondary" disabled={Boolean(working)} onClick={() => { setOnlineOpen(current => !current); setOnlineTarget(null); }}>
            <Globe2 size={17} aria-hidden="true" /> {onlineOpen ? 'Hide online search' : 'Find online recipes'}
          </button>
        </div>}
        {!saved && onlineOpen && <OnlineRecipeDiscovery target={onlineTarget} onImported={importedOnlineRecipe}
          onClose={() => {setOnlineOpen(false); setOnlineTarget(null);}} />}
        {error && <p role="alert" className="kswg-error"><AlertTriangle size={18} aria-hidden="true" />{error}</p>}
        {saved && <div role="status" className="kswg-success"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>Your weekly plan is saved</strong>
          <p>{saved.saved_count} meals saved · {saved.kept_completed} cooked meals kept.</p>
          {refreshFailed && <p>Saved successfully, but the screen could not refresh. Reload KitchenSync to see the saved plan and current Shopping needs.</p>}</div></div>}
        {!saved && <div className="kswg-preview-toolbar"><div><strong>Seven-day preview</strong><p>{dirty ? 'Preferences changed. Regenerate before saving.' : `${locked} cooked meals protected`}</p></div>
          <button type="button" className="kswg-secondary" disabled={Boolean(working)} onClick={pinned && !dirty ? regenerateUnlocked : generate}>
            {working === 'generate' ? <LoaderCircle className="kswg-spin" size={16} /> : <RefreshCw size={16} />} {dirty ? 'Update suggestions' : pinned ? `Regenerate unlocked (${pinned} kept)` : 'Regenerate week'}
          </button></div>}
        {customized && !dirty && !saved && <p className="kswg-warning-inline">You customized the schedule. Confirm & Save preserves your selected recipes. Shopping totals in this preview are hidden until saved because ingredient requirements changed.</p>}
        {working === 'generate' && <p className="kswg-loading" role="status"><LoaderCircle className="kswg-spin" size={20} /> Matching recipes to your week…</p>}
        {preview && <>
          {preview.notices.length > 0 && <div className="kswg-notices">{preview.notices.map(notice => <p key={notice}>{notice}</p>)}</div>}
          <div className={`kswg-days ${dirty ? 'kswg-stale' : ''}`}>
            {days.map(day => <section key={day} className="kswg-day" aria-label={prettyDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}>
              <h3>{prettyDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
              {TYPES.map(kind => {
                const meal = preview.meals.find(item => item.meal_date === day && item.meal_type === kind);
                const replacing = working === `${day}-${kind}`;
                return <article key={kind} className={`kswg-meal ${meal.locked ? 'kswg-locked' : ''}`}>
                  <span className="kswg-food" aria-hidden="true">{ICONS[kind]}</span>
                  <div className="kswg-meal-info"><span className="kswg-meal-type">{kind}{meal.locked ? ' · Cooked, kept' : ''}</span>
                    <h4>{meal.recipe_name}</h4><p><Clock3 size={13} aria-hidden="true" />{meal.minutes ? `${meal.minutes} min` : 'Time unavailable'} <UsersRound size={13} aria-hidden="true" />{meal.eaters} people</p>
                    <p className="kswg-macro-line">{fmt(meal.nutrition?.calories, ' kcal')} · P {fmt(meal.nutrition?.protein_g, 'g')} · C {fmt(meal.nutrition?.carbs_g, 'g')} · F {fmt(meal.nutrition?.fat_g, 'g')} <span>per serving</span></p>
                    <small className="kswg-nutrition-source">{meal.nutrition?.source === 'illustrative' ? 'Illustrative calories' : meal.nutrition?.source === 'user_entered' ? 'User-entered nutrition' : 'Nutrition not verified'}</small>
                  </div>
                  {!saved && !meal.locked && <button type="button" className="kswg-pin" title={userLocks[`${day}-${kind}`] ? 'Unlock this suggestion' : 'Keep this meal when regenerating'}
                    aria-label={userLocks[`${day}-${kind}`] ? `Unlock ${day} ${kind}` : `Lock ${day} ${kind}`}
                    aria-pressed={Boolean(userLocks[`${day}-${kind}`])}
                    onClick={() => setUserLocks(old => ({...old, [`${day}-${kind}`]: !old[`${day}-${kind}`]}))}>
                    {userLocks[`${day}-${kind}`] ? <LockKeyhole size={17}/> : <LockKeyholeOpen size={17}/>}
                  </button>}
                  {!saved && !meal.locked && <button type="button" className="kswg-replace" disabled={Boolean(working) || dirty}
                    onClick={() => setEditingKey(current => current === `${day}-${kind}` ? null : `${day}-${kind}`)}
                    aria-expanded={editingKey === `${day}-${kind}`} aria-label={`Edit ${day} ${kind}`} title="Edit this meal">
                      {replacing ? <LoaderCircle className="kswg-spin" size={17} /> : <Pencil size={17} />}<span>Edit</span></button>}
                  {!saved && !meal.locked && editingKey === `${day}-${kind}` && <div className="kswg-editor">
                    <label>Choose your recipe
                      <select value={meal.recipe_id} disabled={Boolean(working) || dirty} onChange={event => chooseSaved(meal, Number(event.target.value))}>
                        {!savedRecipes.some(r => Number(r.id) === Number(meal.recipe_id)) &&
                          <option value={meal.recipe_id}>{meal.recipe_name}</option>}
                        {savedRecipes.filter(r => r.category?.toLowerCase() === kind).map(r =>
                          <option value={r.id} key={r.id}>{r.name}</option>)}
                      </select>
                    </label>
                    <div className="kswg-editor-actions">
                      <button type="button" className="kswg-secondary" disabled={Boolean(working) || dirty} onClick={() => replace(meal)}>
                        <RefreshCw size={15} aria-hidden="true"/> Suggest another
                      </button>
                      <button type="button" className="kswg-secondary" disabled={Boolean(working) || dirty}
                        onClick={() => {setOnlineTarget(meal); setOnlineOpen(true); setEditingKey(null);}}>
                        <Globe2 size={15} aria-hidden="true"/> Find online
                      </button>
                    </div>
                    <NutritionEditor recipe={savedRecipes.find(r => Number(r.id) === Number(meal.recipe_id))}
                      onSave={saveNutrition} disabled={Boolean(working)} />
                    <small>Choose your own dish, or discover a new one online. Final saving checks diet and attendance rules.</small>
                  </div>}
                  {meal.why?.length > 0 && <details className="kswg-why"><summary>Why this meal?</summary>
                    <ul>{meal.why.map((reason,i) => <li key={i}>{reason}</li>)}</ul>
                  </details>}
                </article>;
              })}
            </section>)}
          </div>
          <details className="kswg-nutrition-summary">
            <summary>Daily calorie & macro summary (per person)</summary>
            <p>Totals assume the same person attends all three meals. Missing recipe nutrition is shown as unavailable rather than zero; actual intake is not tracked here.</p>
            {previewNutrition(preview.meals).map(day =>
              <div key={day.date} className="kswg-nutrition-day">
                <strong>{prettyDate(day.date)}</strong>
                <span>{fmt(day.per_person_if_attending_all.calories, ' kcal')} · Protein {fmt(day.per_person_if_attending_all.protein_g, 'g')} · Carbs {fmt(day.per_person_if_attending_all.carbs_g, 'g')} · Fat {fmt(day.per_person_if_attending_all.fat_g, 'g')}</span>
                <small>{day.known_meals}/3 meals have calorie data</small>
              </div>
            )}
          </details>
          {(!customized || saved) ? <details className="kswg-shopping"><summary>{(saved?.audit || preview.audit).shopping.length} ingredients to buy for this plan</summary>
            <p>Stock is allocated once, in meal order, using existing expiry and serving rules. Planning does not deduct Pantry stock.</p>
            {(saved?.audit || preview.audit).shopping.length ? <ul>{(saved?.audit || preview.audit).shopping.map(item =>
              <li key={item.name}><span>{item.name}</span><strong>{item.missing} {item.unit}</strong></li>)}</ul> : <p>All open meals have enough tracked usable ingredients.</p>}
          </details> : <p className="kswg-warning-inline">Shopping totals will update after saving your customized week. No Pantry stock is deducted during planning.</p>}
        </>}
      </div>
      <form className="kswg-footer" onSubmit={save}>
        {!saved && preview && <>
          {preview.replace_count > 0 && <p className="kswg-replace-warning"><AlertTriangle size={16} aria-hidden="true" /> Saving may replace {preview.replace_count} existing uncooked meal selections in this week. Cooked meals are protected.</p>}
          <label className="kswg-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(working) || dirty}
            onChange={event => setConfirmed(event.target.checked)} />I reviewed these 21 meals and confirm saving this week, including replacement of existing uncooked selections.</label>
        </>}
        <div className="kswg-actions"><button type="button" className="kswg-secondary" disabled={saving} onClick={onClose}>{saved ? 'Close' : 'Cancel'}</button>
          {!saved && <button type="submit" className="kswg-primary" disabled={!preview || !confirmed || dirty || Boolean(working)}>
            {saving ? <LoaderCircle className="kswg-spin" size={17} /> : <CheckCircle2 size={17} />} {saving ? 'Saving week…' : 'Confirm & Save Weekly Plan'}
          </button>}</div>
      </form>
    </section>
  </div>;
}


function NutritionEditor({recipe, onSave, disabled}) {
  const fields = [['calories_per_serving','Calories (kcal)'],['protein_g_per_serving','Protein (g)'],
    ['carbs_g_per_serving','Carbs (g)'],['fat_g_per_serving','Fat (g)']];
  const [values,setValues] = useState({});
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  if (!recipe) return null;
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const payload = Object.fromEntries(fields.map(([key]) => [key,
        (values[key] ?? (key==='calories_per_serving' ? recipe[key] || '' : recipe[key] ?? '')) === ''
          ? null : Number(values[key] ?? recipe[key]) ]));
      await onSave(recipe.id, payload);
      setMessage('Saved. Values are user-entered, not independently verified.');
    } catch(err) { setMessage(err.message || 'Could not save nutrition values'); }
    finally {setBusy(false);}
  }
  return <details className="kswg-nutrition-edit" key={recipe.id}><summary>Set nutrition per serving (optional)</summary>
    <form onSubmit={submit}>
      <div className="kswg-macro-inputs">
        {fields.map(([key,label]) => <label key={key}>{label}
          <input type="number" min="0" step="0.1" placeholder="Unknown"
            value={values[key] ?? (key==='calories_per_serving' ? recipe[key] || '' : recipe[key] ?? '')}
            onChange={e => setValues(old => ({...old,[key]:e.target.value}))}/>
        </label>)}
      </div>
      <button type="submit" className="kswg-secondary" disabled={busy || disabled}>{busy?'Saving…':'Save nutrition'}</button>
      {message && <p role="status" className="kswg-help">{message}</p>}
    </form>
  </details>;
}
