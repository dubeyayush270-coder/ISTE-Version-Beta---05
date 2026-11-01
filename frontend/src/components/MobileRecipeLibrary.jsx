import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookMarked, BookOpen, CalendarPlus, CheckCircle2, ChefHat, Clock3,
  Flame, Globe2, Heart, History, Leaf, Pencil, Search, Settings2, ShoppingBasket,
  Sparkles, Star, UsersRound, WifiOff, X, AlertTriangle, IndianRupee } from 'lucide-react';
import { api, dateISO, recipeIcon, scaleRecipe } from '../lib/api';
import OnlineRecipeDiscovery from './OnlineRecipeDiscovery.jsx';
import RecipeHubEditor from './RecipeHubEditor.jsx';
import { cacheRecipeHubOverview, readOfflineRecipeHubOverview } from '../lib/offlineRecipes.js';
import './MobileRecipeLibrary.css';
import './WeeklyPlanGenerator.css';

const EMPTY = { profiles:{}, prices:[], history:[] };
const SUBSTITUTIONS = {
  'paneer': ['Firm tofu (vegan; flavor and macros will change)'],
  'butter': ['Suitable plant-based butter (check dairy-free label)', 'Oil (changes texture and flavor)'],
  'milk': ['Unsweetened soy milk (check allergens)'],
  'yogurt': ['Plain dairy-free yogurt (check recipe compatibility)'],
  'cream': ['Unsweetened plant cream (check allergens)'],
  'rice': ['Quinoa (adjust water and cooking time)'],
  'peanuts': ['Roasted seeds (check allergies and recipe suitability)'],
  'wheat flour': ['Suitable gluten-free flour blend (different binding behavior)'],
  'egg': ['Recipe-specific egg substitute (not reliable for all recipes)'],
};
function Artwork({ recipe }) {
  const [failed, setFailed] = useState(false);
  useEffect(()=>setFailed(false),[recipe.id]);
  const img = recipe.image_url || recipe.photo_url;
  return <div className="ksrh-art">{img && !failed ? <img src={img} alt={recipe.name} loading="lazy" onError={()=>setFailed(true)}/> : <span aria-hidden="true">{recipeIcon(recipe)}</span>}</div>;
}
function getNutrition(recipe, key) {
  if (key === 'calories_per_serving' && (recipe.nutrition_source === 'unknown' || recipe.nutrition_source === '')) return null;
  const value = recipe[key];
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}
function status(recipe, inventory, eaters, prices) {
  const pantry = new Map();
  for (const item of inventory) {
    if (item.usable === false || !item.name) continue;
    const key = `${item.name.trim().toLowerCase()}|${item.unit}`;
    const qty = Number(item.usable_quantity ?? item.quantity ?? 0);
    pantry.set(key,(pantry.get(key)||0)+qty);
  }
  const rows = scaleRecipe(recipe, eaters).map(ingredient => {
    const key = `${ingredient.name.trim().toLowerCase()}|${ingredient.unit}`;
    const available = pantry.get(key)||0;
    const price = prices.find(p=>p.ingredient_key === ingredient.name.trim().toLowerCase() && p.unit === ingredient.unit);
    return {...ingredient, available, missing:Math.max(0,ingredient.quantity-available), price:price?.price_per_unit ?? null};
  });
  const missing = rows.filter(x=>x.missing>0);
  const known = rows.filter(x=>x.price!==null).length;
  const totalCost = rows.reduce((sum,x)=>sum+(x.price===null?0:x.quantity*x.price),0);
  return { rows, missing, ready:missing.length===0, known, totalCost,
    expiryRelevant:inventory.filter(i=>i.usable!==false&&i.expiry_date&&i.expiry_date>=dateISO(new Date())&&i.expiry_date<=dateISO(new Date(Date.now()+3*86400000))&&
      rows.some(r=>r.name.trim().toLowerCase()===i.name.trim().toLowerCase()&&r.unit===i.unit)) };
}

export default function MobileRecipeLibrary({ recipes=[], inventory=[], householdSize=2, onOpenRecipe, onNavigate, onRefresh, onNotify, onSchedule, offline=false }) {
  const [tab,setTab] = useState('explore');
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('all');
  const [filter,setFilter] = useState('all');
  const [collection,setCollection] = useState('all');
  const [eaters,setEaters] = useState(householdSize);
  const [overview,setOverview] = useState(EMPTY);
  const [error,setError] = useState('');
  const [editing,setEditing] = useState(null);
  const [profileRecipe,setProfileRecipe] = useState(null);
  const [draft,setDraft] = useState(null);
  const [priceRecipe,setPriceRecipe] = useState(null);
  const [priceDraft,setPriceDraft] = useState({ingredient:'',unit:'g',rupees:''});
  const [slotRecipe,setSlotRecipe] = useState(null);
  const [slotDate,setSlotDate] = useState(dateISO(new Date()));
  const [slotType,setSlotType] = useState('lunch');
  const [busy,setBusy] = useState(false);
  const [online,setOnline] = useState(!offline);
  useEffect(()=>{setEaters(Math.max(1,Math.min(30,Number(householdSize)||2)));},[householdSize]);
  async function loadOverview() {
    try {
      const value=await api('/recipe-hub/overview');
      setOverview(value); setOnline(true);
      cacheRecipeHubOverview(value).catch(()=>{});
    } catch {
      setOnline(false);
      try { const saved=await readOfflineRecipeHubOverview(); if(saved)setOverview(saved); } catch { /* offline metadata unavailable */ }
    }
  }
  useEffect(()=>{loadOverview();},[recipes.length,offline]);
  const profiles=overview.profiles || {};
  const prices=overview.prices || [];
  const history=overview.history || [];
  const annotated=useMemo(()=>recipes.map(recipe=>({
    ...recipe,...status(recipe,inventory,eaters,prices),
    meta:profiles[String(recipe.id)]||{},
    cooked:history.find(h=>h.recipe_id===recipe.id)?.times_cooked||0,
  })),[recipes,inventory,eaters,prices,profiles,history]);
  const categories=useMemo(()=>['all',...new Set(recipes.map(r=>String(r.category).toLowerCase()))],[recipes]);
  const collections=useMemo(()=>['all',...new Set(Object.values(profiles).flatMap(p=>p.collections||[]))],[profiles]);
  const visible=useMemo(()=>annotated.filter(r=>{
    const text=`${r.name} ${r.category} ${(r.tags||[]).join(' ')} ${r.ingredients.map(i=>i[0]).join(' ')}`.toLowerCase();
    if (query.trim()&&!text.includes(query.trim().toLowerCase())) return false;
    if(category!=='all'&&r.category.toLowerCase()!==category)return false;
    if(tab==='saved'&&!r.meta.favorite && !(r.tags||[]).includes('online') && !(r.tags||[]).includes('custom'))return false;
    if(tab==='history'&&!r.cooked)return false;
    if(tab==='saved'&&collection!=='all'&&!(r.meta.collections||[]).includes(collection))return false;
    if(filter==='ready'&&!r.ready)return false;
    if(filter==='fast'&&Number(r.minutes)>30)return false;
    if(filter==='protein'&&!(getNutrition(r,'protein_g_per_serving')>=20))return false;
    if(filter==='vegetarian'&&!(r.tags||[]).some(t=>String(t).toLowerCase()==='vegetarian'))return false;
    if(filter==='expiry'&&!r.expiryRelevant.length)return false;
    return true;
  }).sort((a,b)=>{
    if(tab==='history')return b.cooked-a.cooked;
    if(filter==='protein')return (getNutrition(b,'protein_g_per_serving')||0)-(getNutrition(a,'protein_g_per_serving')||0);
    if(filter==='expiry')return b.expiryRelevant.length-a.expiryRelevant.length;
    return Number(b.ready)-Number(a.ready) || Number(b.meta.favorite)-Number(a.meta.favorite) || (Number(b.meta.rating)||0)-(Number(a.meta.rating)||0) || b.cooked-a.cooked;
  }),[annotated,query,category,filter,tab,collection]);
  async function changeProfile(recipe,payload) {
    if(offline||!online) {setError('Connect to the internet to save changes. Your offline library remains readable.');return;}
    setBusy(true);setError('');
    try {
      await api(`/recipe-hub/recipes/${recipe.id}/profile`,{method:'PUT',body:JSON.stringify(payload)});
      await loadOverview();
      setProfileRecipe(null);onNotify?.('Recipe preferences saved');
    } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  function openProfile(recipe) {
    setDraft({favorite:!!recipe.meta.favorite,rating:recipe.meta.rating??'',notes:recipe.meta.notes||'',collections:(recipe.meta.collections||[]).join(', ')});
    setProfileRecipe(recipe);
  }
  async function saveProfile(e) {
    e.preventDefault();
    await changeProfile(profileRecipe,{favorite:draft.favorite,rating:draft.rating===''?null:Number(draft.rating),notes:draft.notes,collections:draft.collections.split(',').map(s=>s.trim()).filter(Boolean)});
  }
  async function toggleFavorite(recipe){await changeProfile(recipe,{favorite:!recipe.meta.favorite,rating:recipe.meta.rating??null,notes:recipe.meta.notes||'',collections:recipe.meta.collections||[]});}
  async function savePrice(e) {
    e.preventDefault(); setBusy(true);setError('');
    try {
      const qty=Number(priceDraft.rupees);
      // Input is rupees per 100 g/ml, or per piece.
      await api('/recipe-hub/prices',{method:'PUT',body:JSON.stringify({
        ingredient:priceDraft.ingredient,unit:priceDraft.unit,
        price_per_unit:qty/(priceDraft.unit==='pcs'?1:100),
      })});
      await loadOverview();setPriceRecipe(null);setPriceDraft({ingredient:'',unit:'g',rupees:''});
      onNotify?.('Price saved as your estimate');
    } catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function openPrice(recipe){
    const first=recipe.ingredients[0];setPriceRecipe(recipe);
    setPriceDraft({ingredient:first[0],unit:first[2],rupees:''});
  }
  function openSchedule(recipe){setSlotRecipe(recipe);setSlotDate(dateISO(new Date()));setSlotType(String(recipe.category).toLowerCase());}
  async function confirmSchedule(e){
    e.preventDefault();
    if (!window.confirm(`Review and set ${slotRecipe.name} for ${slotDate} ${slotType}? Existing uncooked meals in this slot may be replaced.`))return;
    onSchedule?.(slotRecipe,slotDate,slotType);setSlotRecipe(null);
  }
  async function imported(result){
    await onRefresh?.(); await loadOverview();setTab('saved');setError('');
    onNotify?.(result.already_imported?'Recipe already exists in your library':'Recipe imported into My Recipes. Available on this device after synchronization.');
  }
  async function savedCopy(result){
    await onRefresh?.();await loadOverview();setEditing(null);setTab('saved');onNotify?.('Personal recipe saved');
  }
  async function recordCooked(recipe){
    if(!window.confirm('Record a cooking-history entry only? This does NOT deduct Pantry stock or mark a planned meal as cooked.'))return;
    setBusy(true);try{await api(`/recipe-hub/recipes/${recipe.id}/cooked`,{method:'POST'});await loadOverview();onNotify?.('Added to Cook Again history (stock unchanged)');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const back=()=>{setProfileRecipe(null);setEditing(null);setPriceRecipe(null);setSlotRecipe(null);setError('');};
  return <div className="ksrh">
    <header className="ksrh-top"><div><small>SMART RECIPE HUB</small><h1>Discover & Cook 🌿</h1><p>Find a recipe, save your favorites, plan and cook.</p></div><ChefHat size={27}/></header>
    {(offline||!online) && <p className="ksrh-offline"><WifiOff size={17}/> Offline recipes are readable. Search, saving and planning need a connection.</p>}
    {error && <div role="alert" className="ksrh-error">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={17}/></button></div>}
    {editing ? <RecipeHubEditor recipe={editing} onSaved={savedCopy} onCancel={back} onNotify={onNotify}/> :
     profileRecipe && draft ? <form className="ksrh-panel ksrh-editor" onSubmit={saveProfile}>
       <button type="button" className="ksrh-back" onClick={back}>← Back</button><h2>Personalize {profileRecipe.name}</h2>
       <label className="ksrh-check"><input type="checkbox" checked={draft.favorite} onChange={e=>setDraft(d=>({...d,favorite:e.target.checked}))}/> Favorite</label>
       <label>Your rating<select value={draft.rating} onChange={e=>setDraft(d=>({...d,rating:e.target.value}))}><option value="">Not rated</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} stars</option>)}</select></label>
       <label>Collections (comma-separated)<input maxLength={300} placeholder="Family favorites, Quick meals" value={draft.collections} onChange={e=>setDraft(d=>({...d,collections:e.target.value}))}/></label>
       <label>Cooking notes<textarea rows={5} maxLength={2000} placeholder="Less spicy, add lemon at the end..." value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))}/></label>
       <button className="ksrh-primary" disabled={busy} type="submit">Save favorites & notes</button>
     </form> : priceRecipe ? <form className="ksrh-panel ksrh-editor" onSubmit={savePrice}>
       <button type="button" className="ksrh-back" onClick={back}>← Back</button><h2>My ingredient price book</h2><p>Enter prices you know. KitchenSync does not claim live market prices. Incomplete recipes won't show a full cost.</p>
       <label>Ingredient<select value={`${priceDraft.ingredient}|${priceDraft.unit}`} onChange={e=>{const [ingredient,unit]=e.target.value.split('|');setPriceDraft({ingredient,unit,rupees:''});}}>{priceRecipe.ingredients.map(([name,,unit],i)=><option key={i} value={`${name}|${unit}`}>{name} ({unit})</option>)}</select></label>
       <label>Estimated price in ₹ per {priceDraft.unit==='pcs'?'piece':`100 ${priceDraft.unit}`}<input type="number" min="0.01" step="0.01" max="100000" required value={priceDraft.rupees} onChange={e=>setPriceDraft(d=>({...d,rupees:e.target.value}))}/></label>
       <button type="submit" className="ksrh-primary" disabled={busy}>Save price estimate</button>
       <p>Repeat for other ingredients to complete a recipe estimate.</p>
     </form> : slotRecipe ? <form className="ksrh-panel ksrh-editor" onSubmit={confirmSchedule}>
       <button type="button" className="ksrh-back" onClick={back}>← Back</button><h2>Add {slotRecipe.name} to weekly plan</h2>
       <label>Date<input type="date" required value={slotDate} onChange={e=>setSlotDate(e.target.value)}/></label>
       <label>Meal slot<select value={slotType} onChange={e=>setSlotType(e.target.value)}>{['breakfast','lunch','dinner'].map(x=><option key={x}>{x}</option>)}</select></label>
       <p>Review family attendance and dietary suitability in the existing meal editor. Completed meals cannot be replaced.</p>
       <button type="submit" className="ksrh-primary" disabled={!onSchedule||offline}>Review in meal planner</button>
     </form> : <>
       <nav className="ksrh-tabs" aria-label="Recipe collections">{[
         ['explore','Explore',Search],['online','Online',Globe2],['saved','My Recipes',BookMarked],['history','Cook Again',History]
       ].map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)} type="button" aria-pressed={tab===id}><Icon size={16}/>{label}</button>)}</nav>
       {tab==='online' ? (offline || !online ? <p className="ksrh-offline">Connect to the internet to discover recipes. Your saved recipe cards remain available offline.</p> : <OnlineRecipeDiscovery target={null} onImported={imported} onClose={()=>setTab('explore')}/>) : <>
         <div className="ksrh-search"><Search size={19}/><input type="search" placeholder="Find dishes or ingredients" aria-label="Search recipes" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear search"><X size={16}/></button>}</div>
         <div className="ksrh-filters"><select aria-label="Recipe category" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c} value={c}>{c==='all'?'All meals':c}</option>)}</select>
           <select aria-label="Recipe preference" value={filter} onChange={e=>setFilter(e.target.value)}>
             <option value="all">All recipes</option><option value="ready">Can cook now</option><option value="expiry">Uses expiring stock</option><option value="fast">Under 30 minutes</option><option value="protein">Known protein ≥20g</option><option value="vegetarian">Tagged vegetarian</option>
           </select>
           {tab==='saved'&&<select aria-label="Recipe collection" value={collection} onChange={e=>setCollection(e.target.value)}>{collections.map(c=><option key={c} value={c}>{c==='all'?'All collections':c}</option>)}</select>}
           <label>People <input type="number" min="1" max="30" value={eaters} onChange={e=>setEaters(Math.max(1,Math.min(30,Number(e.target.value)||1)))}/></label>
         </div>
         <div className="ksrh-summary"><div><h2>{tab==='saved'?'My Recipes':tab==='history'?'Cook Again':'Recommended recipes'}</h2><p>{visible.length} results · {eaters} people · {annotated.filter(r=>r.ready).length} Pantry-ready</p></div></div>
         <div className="ksrh-grid">{visible.map(recipe=>{
           const coverage=recipe.rows.length?Math.round((recipe.rows.length-recipe.missing.length)*100/recipe.rows.length):0;
           const profile=recipe.meta;
           const custom=(recipe.tags||[]).includes('custom');
           const imported=(recipe.tags||[]).includes('online');
           const reasons=[`${coverage}% of ingredients in recorded Pantry`,recipe.ready?'Enough usable stock':'Shopping needed for missing ingredients',
             recipe.expiryRelevant.length?`${recipe.expiryRelevant.length} usable ingredient(s) near recorded expiry; verify freshness`:'No expiring ingredients matching this recipe',
             getNutrition(recipe,'protein_g_per_serving')!==null?`${getNutrition(recipe,'protein_g_per_serving')}g protein per serving (saved value)`:'Protein data unavailable'];
           return <article className="ksrh-card" key={recipe.id}>
             <Artwork recipe={recipe}/>
             <div className="ksrh-card-body">
               <div className="ksrh-tagline"><span>{recipe.category}</span>{imported&&<span>Imported</span>}{custom&&<span>My version</span>}{recipe.cooked>0&&<span>Cooked {recipe.cooked}×</span>}</div>
               <h3>{recipe.name}</h3>
               {profile.collections?.length>0&&<p className="ksrh-meta">Collections: {profile.collections.join(', ')}</p>}
               <p className="ksrh-meta"><Clock3 size={15}/>{recipe.minutes} min <UsersRound size={15}/>{recipe.base_servings} base servings</p>
               <p className="ksrh-meta"><Flame size={15}/>{getNutrition(recipe,'calories_per_serving')===null?'Calories unavailable':`${getNutrition(recipe,'calories_per_serving')} kcal/serving`}</p>
               <p className="ksrh-meta">Protein {getNutrition(recipe,'protein_g_per_serving')??'—'} g · Carbs {getNutrition(recipe,'carbs_g_per_serving')??'—'} g · Fat {getNutrition(recipe,'fat_g_per_serving')??'—'} g</p>
               <p className={`ksrh-pantry ${recipe.ready?'ready':'missing'}`}>{recipe.ready?<CheckCircle2 size={16}/>:<ShoppingBasket size={16}/>} {recipe.ready?'Ready with tracked Pantry':`${recipe.missing.length} ingredients missing`} · {coverage}% match</p>
               <details className="ksrh-details"><summary>Why this meal? · Costs · Swaps</summary>
                 <ul>{reasons.map(r=><li key={r}>{r}</li>)}</ul>
                 {recipe.known===recipe.rows.length&&recipe.rows.length>0 ? <p><IndianRupee size={14}/> Estimated ₹{recipe.totalCost.toFixed(2)} total / ₹{(recipe.totalCost/eaters).toFixed(2)} per person · <button onClick={()=>openPrice(recipe)}>Update my prices</button></p> : <p>Cost unavailable for {recipe.rows.length-recipe.known} ingredient(s). <button onClick={()=>openPrice(recipe)}>Enter my prices</button></p>}
                 {recipe.missing.length>0&&<div><strong>Possible substitutions (review before cooking)</strong><ul>{recipe.missing.flatMap(item=>(SUBSTITUTIONS[item.name.trim().toLowerCase()]||[]).map(s=>`${item.name}: ${s}`)).slice(0,6).map(x=><li key={x}>{x}</li>)}</ul><p>Substitutions are ideas only; Pantry and macros are not changed until you save a modified recipe.</p></div>}
                 {recipe.source_url&&<p><a href={recipe.source_url} target="_blank" rel="noreferrer">Original recipe source</a> (requires internet)</p>}
                 {profile.notes&&<p><strong>My notes:</strong> {profile.notes}</p>}
                 {profile.rating&&<p>My rating: {profile.rating}/5 stars</p>}
               </details>
               <div className="ksrh-actions">
                 <button className="ksrh-primary" onClick={()=>onOpenRecipe?.(recipe)}><ChefHat size={17}/> View & Cook</button>
                 <button aria-label={profile.favorite?'Remove favorite':'Add favorite'} title="Favorite" className={profile.favorite?'ksrh-loved':'ksrh-icon'} onClick={()=>toggleFavorite(recipe)} disabled={busy||offline||!online}><Heart size={18} fill={profile.favorite?'currentColor':'none'}/></button>
               </div>
               <div className="ksrh-actions-secondary">
                 <button onClick={()=>openSchedule(recipe)} disabled={offline||!online}><CalendarPlus size={15}/> Plan</button>
                 <button onClick={()=>setEditing(recipe)} disabled={offline||!online}><Pencil size={15}/> My version</button>
                 <button onClick={()=>openProfile(recipe)} disabled={offline||!online}><Star size={15}/> Save / rate</button>
                 <button onClick={()=>recordCooked(recipe)} disabled={busy||offline||!online}><History size={15}/> Cooked</button>
               </div>
             </div>
           </article>;
         })}</div>
         {!visible.length&&<div className="ksrh-panel ksrh-empty"><BookOpen size={30}/><h3>No recipes in this view</h3><p>{tab==='saved'?'Import online recipes or favorite a saved meal.':tab==='history'?'Record a cooking session or complete a planned meal.':'Try another search or filter.'}</p><button className="ksrh-secondary" onClick={()=>{setQuery('');setFilter('all');setCategory('all');setTab('explore');}}>Browse all recipes</button></div>}
       </>}
     </>}
    <button className="ksrh-assistant" onClick={()=>onNavigate?.('assistant')}><Sparkles size={22}/><span><strong>Need inspiration?</strong><small>Ask KitchenSync what you can cook from your Pantry</small></span><ArrowRight size={18}/></button>
    <p className="ksrh-disclaimer">Nutrition from saved sources may be illustrative. Missing macros are unknown, not zero. Availability checks use recorded Pantry stock; verify freshness and food safety. Device-side offline copies include recipe text, ingredients and steps; online images may be unavailable without internet.</p>
  </div>;
}
