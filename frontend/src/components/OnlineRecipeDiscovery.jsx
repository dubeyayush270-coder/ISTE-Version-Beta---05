import { useEffect, useState } from 'react';
import { Globe2, LoaderCircle, Search, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';

const FALLBACK = { quantity: '', unit: 'g' };

/** Online recipes are preview-only until the user reviews and imports every amount. */
export default function OnlineRecipeDiscovery({ target, onImported, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amounts, setAmounts] = useState([]);
  const [category, setCategory] = useState(target?.meal_type || 'lunch');
  const [servings, setServings] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [nutrition, setNutrition] = useState({ calories_per_serving: '', protein_g_per_serving: '', carbs_g_per_serving: '', fat_g_per_serving: '' });
  const [sourceNutrition, setSourceNutrition] = useState(null);
  const [nutritionLoading, setNutritionLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setCategory(target?.meal_type || 'lunch'); }, [target]);

  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy('search'); setError(''); setSelected(null); setResults([]);
    try {
      const result = await api(`/recipes/online/search?q=${encodeURIComponent(query.trim())}`);
      setResults(result.recipes || []);
    } catch (err) { setError(err.message || 'Online search unavailable'); }
    finally { setBusy(''); }
  }

  async function inspect(mealId) {
    setBusy(mealId); setError(''); setConfirmed(false);
    try {
      const detail = await api(`/recipes/online/${encodeURIComponent(mealId)}`);
      setSelected(detail);
      setServings('');
      setNutrition({ calories_per_serving: '', protein_g_per_serving: '', carbs_g_per_serving: '', fat_g_per_serving: '' });
      setSourceNutrition(null);
      setAmounts(detail.ingredients.map(item => ({
        name: item.name,
        quantity: item.quantity ?? '',
        unit: item.unit || FALLBACK.unit,
      })));
    } catch (err) { setError(err.message || 'Could not load recipe details'); }
    finally { setBusy(''); }
  }

  async function importNutritionFromSource() {
    if (!selected?.meal_id) return;
    setNutritionLoading(true);
    setSourceNutrition(null);
    setError('');
    try {
      const result = await api(`/recipes/online/${encodeURIComponent(selected.meal_id)}/source-nutrition`);
      const keys = ['calories_per_serving', 'protein_g_per_serving', 'carbs_g_per_serving', 'fat_g_per_serving'];
      setNutrition(Object.fromEntries(keys.map(key => [key,
        result.values?.[key] == null ? '' : String(result.values[key])])));
      setSourceNutrition(result);
      setConfirmed(false);
    } catch (err) {
      setError(err.message || 'Source nutrition unavailable. Enter values manually.');
    } finally {
      setNutritionLoading(false);
    }
  }

  function editAmount(index, field, value) {
    setAmounts(old => old.map((row, i) => i === index ? { ...row, [field]: value } : row));
    setConfirmed(false);
  }

  const valid = Boolean(selected?.steps?.length && amounts.length && amounts.every(item =>
    Number(item.quantity) > 0 && Number.isFinite(Number(item.quantity)) &&
    (item.unit !== 'pcs' || Number.isInteger(Number(item.quantity)))
  ));

  async function importRecipe(event) {
    event.preventDefault();
    if (!valid || !confirmed || !selected) return;
    setBusy('import'); setError('');
    try {
      const result = await api('/recipes/online/import', {
        method: 'POST', body: JSON.stringify({
          meal_id: selected.meal_id, category, base_servings: Number(servings),
          minutes: Number(minutes), confirmed: true,
          ...Object.fromEntries(Object.entries(nutrition).map(([key, value]) =>
            [key, value === '' ? null : Number(value)])),
          ingredients: amounts.map(item => ({ name: item.name,
            quantity: Number(item.quantity), unit: item.unit })),
        }),
      });
      await onImported(result, category);
    } catch (err) { setError(err.message || 'Import failed'); }
    finally { setBusy(''); }
  }

  return <section className="kswg-online" aria-label="Discover online recipes">
    <div className="kswg-online-heading">
      <div><strong><Globe2 size={18} aria-hidden="true"/> Find an online recipe</strong>
        <p>{target ? `Add a new recipe for ${target.meal_date} ${target.meal_type}.` : 'Import a reviewed recipe into your library, then regenerate the week.'}</p></div>
      <button type="button" className="kswg-icon-button" aria-label="Close online search" onClick={onClose} disabled={busy === 'import'}><X size={17}/></button>
    </div>
    <form className="kswg-online-search" onSubmit={search}>
      <input aria-label="Search online recipe names" placeholder="e.g. pasta, curry, biryani" minLength={2} maxLength={60}
        value={query} onChange={e => setQuery(e.target.value)} />
      <button type="submit" className="kswg-primary" disabled={Boolean(busy) || query.trim().length < 2}>
        {busy === 'search' ? <LoaderCircle className="kswg-spin" size={17}/> : <Search size={17}/>} Search
      </button>
    </form>
    {error && <p role="alert" className="kswg-error">{error}</p>}
    {!busy && !selected && query && !results.length && !error && <p className="kswg-help">Search for dishes by name. The online provider may not have every Indian recipe.</p>}
    {!selected && results.length > 0 && <div className="kswg-results">
      {results.map(item => <button className="kswg-result" key={item.meal_id} type="button"
        onClick={() => inspect(item.meal_id)} disabled={Boolean(busy)}>
        {item.image && <img src={item.image} alt="" loading="lazy"/>}
        <span><strong>{item.name}</strong><small>{item.area || item.category || 'Online recipe'} · TheMealDB</small></span>
        {busy === item.meal_id ? <LoaderCircle className="kswg-spin" size={17}/> : <span aria-hidden="true">›</span>}
      </button>)}
    </div>}
    {selected && <form className="kswg-review" onSubmit={importRecipe}>
      <div className="kswg-online-heading"><div>
        <strong>{selected.name}</strong>
        <p>Review quantities before using this recipe for Pantry, Shopping or meal planning.</p>
      </div><button type="button" className="kswg-secondary" onClick={() => {setSelected(null); setConfirmed(false);}} disabled={busy === 'import'}>Back to results</button></div>
      <div className="kswg-review-meta">
        <label>Meal type<select value={category} disabled={Boolean(target)} onChange={e => {setCategory(e.target.value);setConfirmed(false);}}>
          <option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option>
        </select></label>
        <label>Original recipe serves how many? <input type="number" min="1" max="30" required placeholder="Confirm servings" value={servings} onChange={e => {setServings(e.target.value);setConfirmed(false);}} /></label>
        <label>Cooking minutes<input type="number" min="1" max="240" required value={minutes} onChange={e => {setMinutes(e.target.value);setConfirmed(false);}} /></label>
      </div>
      <p className="kswg-help">Specify how many servings the source ingredient list makes. KitchenSync scales those amounts for each meal's actual attendees.</p>
      <fieldset className="kswg-nutrition-input">
        <legend>Optional nutrition per serving</legend>
        <p className="kswg-help">Enter values only from a reliable recipe label or your own reviewed estimate. Blank means unavailable, not zero. Quantities automatically scale with family attendance.</p>
        {selected?.source_url && /^https:\/\/(?:www\.)?bbcgoodfood\.com\/recipes\//i.test(selected.source_url) &&
          <button type="button" className="kswg-secondary" disabled={Boolean(busy) || nutritionLoading}
            onClick={importNutritionFromSource}>
            {nutritionLoading ? 'Checking source…' : 'Import nutrition from source'}
          </button>}
        {sourceNutrition && <p className="kswg-help" role="status">
          Source: {sourceNutrition.title || sourceNutrition.source}.
          {sourceNutrition.recipe_yield ? ` Makes ${sourceNutrition.recipe_yield}.` : ''}
          {sourceNutrition.serving_size ? ` Serving: ${sourceNutrition.serving_size}.` : ''}
          {' '}Review the source recipe, portion size and values before confirming.
        </p>}
        {[
          ['calories_per_serving', 'Calories (kcal)'],
          ['protein_g_per_serving', 'Protein (g)'],
          ['carbs_g_per_serving', 'Carbs (g)'],
          ['fat_g_per_serving', 'Fat (g)'],
        ].map(([key, label]) => <label key={key}>{label}
          <input type="number" min="0" step="0.1" placeholder="Unknown" value={nutrition[key]}
            onChange={event => {setNutrition(prev => ({...prev, [key]: event.target.value})); setConfirmed(false);}} />
        </label>)}
      </fieldset>
      <p className="kswg-help"><ShieldCheck size={16} aria-hidden="true"/> Values without explicit g/ml/pcs measurements are intentionally blank. Please enter amounts from your recipe knowledge or the original recipe. Do not guess.</p>
      <div className="kswg-review-ingredients">
        {selected.ingredients.map((item, index) => <div className="kswg-ingredient" key={`${item.name}-${index}`}>
          <div><strong>{item.name}</strong><small>Source: {item.original_measure || 'not stated'}</small></div>
          <input aria-label={`${item.name} quantity`} type="number" min="0.01" step="0.01" required placeholder="Quantity"
            value={amounts[index]?.quantity ?? ''} onChange={e => editAmount(index, 'quantity', e.target.value)} />
          <select aria-label={`${item.name} unit`} value={amounts[index]?.unit || 'g'} onChange={e => editAmount(index, 'unit', e.target.value)}>
            <option value="g">g</option><option value="ml">ml</option><option value="pcs">pcs</option>
          </select>
        </div>)}
      </div>
      <details className="kswg-steps"><summary>Read original cooking instructions</summary>
        <ol>{selected.steps?.map((step, i) => <li key={i}>{step}</li>)}</ol>
        {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer">Open original recipe source</a>}
      </details>
      <label className="kswg-confirm"><input type="checkbox" checked={confirmed} disabled={!valid || Boolean(busy)}
        onChange={e => setConfirmed(e.target.checked)}/>
        I checked all ingredient amounts, cooking time, and dietary suitability. Import this recipe into my saved library.</label>
      <button type="submit" className="kswg-primary" disabled={!valid || !confirmed || Boolean(busy) || !(Number(servings) >= 1 && Number(servings) <= 30) || !(Number(minutes) >= 1 && Number(minutes) <= 240)}>
        {busy === 'import' ? <LoaderCircle className="kswg-spin" size={17}/> : <ShieldCheck size={17}/>} Import reviewed recipe
      </button>
    </form>}
    <p className="kswg-provider">Recipes sourced from TheMealDB. An internet connection is required. No meals or leftovers are automatically recorded.</p>
  </section>;
}
