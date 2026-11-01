import { useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

export default function RecipeHubEditor({ recipe, onSaved, onCancel, onNotify }) {
  const [name, setName] = useState(`My ${recipe.name}`.slice(0, 140));
  const [category, setCategory] = useState(String(recipe.category || 'lunch').toLowerCase());
  const [servings, setServings] = useState(recipe.base_servings || 2);
  const [minutes, setMinutes] = useState(recipe.minutes || 30);
  const [ingredients, setIngredients] = useState((recipe.ingredients || []).map(([name, quantity, unit]) => ({name, quantity, unit})));
  const [steps, setSteps] = useState((recipe.steps || []).join('\n'));
  const [macros, setMacros] = useState({ calories_per_serving: '', protein_g_per_serving: '', carbs_g_per_serving: '', fat_g_per_serving: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (index, key, value) => setIngredients(old => old.map((i, n) => n === index ? { ...i, [key]: value } : i));
  async function save(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api(`/recipe-hub/recipes/${recipe.id}/copy`, { method: 'POST', body: JSON.stringify({
        name: name.trim(), category, base_servings: Number(servings), minutes: Number(minutes),
        tags: ['personal'],
        ingredients: ingredients.map(i => ({name: i.name.trim(), quantity: Number(i.quantity), unit: i.unit})),
        steps: steps.split('\n').map(s=>s.trim()).filter(Boolean),
        ...Object.fromEntries(Object.entries(macros).map(([k,v])=>[k,v === '' ? null : Number(v)])),
      }) });
      await onSaved(result);
    } catch(err) { setError(err.message); onNotify?.(err.message, true); }
    finally { setBusy(false); }
  }
  return <form className="ksrh-panel ksrh-editor" onSubmit={save}>
    <button className="ksrh-back" type="button" onClick={onCancel}><ArrowLeft size={18}/> Back to recipes</button>
    <h2>Save my version</h2>
    <p>Your original recipe stays unchanged. Ingredients and cooking instructions can be personalized. Nutrition is cleared until you review it.</p>
    {error && <p role="alert" className="ksrh-error">{error}</p>}
    <label>New recipe name<input required maxLength={140} minLength={2} value={name} onChange={e=>setName(e.target.value)} /></label>
    <div className="ksrh-row">
      <label>Meal type<select value={category} onChange={e=>setCategory(e.target.value)}>{['breakfast','lunch','dinner'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Original servings<input type="number" min="1" max="30" value={servings} required onChange={e=>setServings(e.target.value)} /></label>
      <label>Cooking time (min)<input type="number" min="1" max="240" value={minutes} required onChange={e=>setMinutes(e.target.value)} /></label>
    </div>
    <h3>Ingredient amounts for {servings || '?'} people</h3>
    {ingredients.map((ing, i) => <div key={i} className="ksrh-ingredient-edit">
      <input aria-label={`Ingredient ${i+1} name`} value={ing.name} required maxLength={80} onChange={e=>update(i,'name',e.target.value)} />
      <input aria-label={`${ing.name} quantity`} type="number" min="0.01" max="1000000" step="0.01" required value={ing.quantity} onChange={e=>update(i,'quantity',e.target.value)} />
      <select aria-label={`${ing.name} unit`} value={ing.unit} onChange={e=>update(i,'unit',e.target.value)}><option>g</option><option>ml</option><option>pcs</option></select>
      <button aria-label={`Remove ${ing.name}`} type="button" disabled={ingredients.length<=1} onClick={()=>setIngredients(x=>x.filter((_,n)=>n!==i))}><Trash2 size={16}/></button>
    </div>)}
    <button className="ksrh-secondary" type="button" disabled={ingredients.length>=40} onClick={()=>setIngredients(x=>[...x,{name:'',quantity:1,unit:'g'}])}><Plus size={17}/> Add ingredient</button>
    <label>Cooking steps (one step per line)<textarea required rows={7} value={steps} onChange={e=>setSteps(e.target.value)}/></label>
    <h3>Optional reviewed nutrition per serving</h3>
    <p>Unknown means blank; changing ingredients invalidates old macro estimates.</p>
    <div className="ksrh-row">{[['calories_per_serving','kcal'],['protein_g_per_serving','Protein g'],['carbs_g_per_serving','Carbs g'],['fat_g_per_serving','Fat g']].map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="0.1" placeholder="Unknown" value={macros[key]} onChange={e=>setMacros(prev=>({...prev,[key]:e.target.value}))}/></label>)}</div>
    <button className="ksrh-primary" disabled={busy} type="submit"><Save size={18}/>{busy?'Saving...':'Save my recipe'}</button>
  </form>;
}
