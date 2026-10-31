import MobileShopping from "./components/MobileShopping.jsx";
import MobileBottomNav from "./components/MobileBottomNav";
import MobileDashboard from "./components/MobileDashboard.jsx";
import MobileMealPlanner from "./components/MobileMealPlanner.jsx";
import MobileRecipeLibrary from "./components/MobileRecipeLibrary.jsx";
import MobileRecipeDetail from "./components/MobileRecipeDetail.jsx";
import MobilePantry from "./components/MobilePantry.jsx";
import AIRecipeFinder from "./components/AIRecipeFinder.jsx";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, CalendarDays, BookOpen, Package, ShoppingBasket, Bot, Settings2,
  ChevronLeft, ChevronRight, Plus, ArrowRight, Check, Clock3, AlertTriangle,
  UsersRound, ChefHat, Search, Trash2, Pencil, CheckCircle2, RefreshCcw,
  Mic, MicOff, Volume2, VolumeX, X, Leaf, Sparkles, CalendarClock, ListChecks,
  TrendingDown, Clipboard, Filter, WandSparkles, ScanLine, Timer, Menu, Minus,
  CircleHelp, Info, ShieldCheck
} from 'lucide-react';
import { api, dateISO, todayISO, monday, addDays, prettyDate, num, displayAmount, scaleRecipe, recipeIcon } from './lib/api';

const SECTIONS = [
  ['dashboard', 'Overview', LayoutDashboard], ['planner', 'Meal planner', CalendarDays],
  ['recipes', 'Recipe library', BookOpen], ['inventory', 'My pantry', Package],
  ['shopping', 'Shopping list', ShoppingBasket], ['assistant', 'Kitchen assistant', Bot],
];
const MEALS = ['breakfast', 'lunch', 'dinner'];

const DEFAULT_STOCK = {
  name: "",
  quantity: 0,
  unit: "g",
  expiry_date: "",
  is_leftover: false,
  prepared_at: "",
  storage: "",

  // Scanner metadata
  date_type: "unknown",
  date_source: "manual",
  barcode: "",
  purchase_date: "",
};

const CAPABILITIES = [
  ['Weekly meals', 'Available'], ['Recipe library', 'Available'], ['Per-meal serving count', 'Available'],
  ['Pantry management', 'Available'], ['Daily + weekly shortages', 'Available'], ['Missing-item alerts', 'Available'],
  ['Shopping list', 'Available'], ['Stock auto-deduction', 'Available'], ['Sample calorie estimates', 'Demo estimates'],
  ['Expiry tracking', 'Available'], ['Live price comparison', 'Planned'], ['English step-by-step voice', 'Browser support'],
  ['External AI recipe tools', 'Planned'], ['Receipt scanning', 'Planned'], ['Advanced leftover reuse', 'Planned'],
  ['Hindi voice + AI dialogue', 'Planned']
];
function Label({ children }) { return <label className="k-label">{children}</label> }
function Button({ children, variant = 'primary', className = '', ...props }) {
  return <button {...props} className={`k-button ${variant === 'primary' ? 'k-primary' : variant === 'outline' ? 'k-outline' : variant === 'danger' ? 'k-danger' : 'k-light'} ${className}`}>{children}</button>;
}
function Tag({ children, tone = 'muted' }) { return <span className={`k-tag k-tag-${tone}`}>{children}</span> }
function SectionHeading({ eyebrow, title, description, action }) {
  return <div className="mb-6 flex flex-wrap justify-between items-start gap-4"><div><div className="text-[11px] tracking-[.17em] uppercase font-bold text-[#3f8861] mb-2">{eyebrow}</div><h1 className="text-[27px] md:text-[31px] leading-tight font-bold tracking-tight text-[#233b2d]">{title}</h1><p className="text-[#748378] text-sm mt-2 max-w-2xl">{description}</p></div>{action}</div>;
}
function EmptyState({ icon: Icon = ChefHat, children }) { return <div className="text-center py-12 text-[#8b998d]"><Icon className="mx-auto mb-3" size={30} /><p className="text-sm">{children}</p></div> }
function Modal({ title, subtitle, children, onClose }) {
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose]);
  return <div className="k-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="k-modal k-scroll"><div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 border-b border-[#e8eee7] px-6 py-5 flex justify-between items-start gap-4"><div><h2 className="text-xl font-bold">{title}</h2>{subtitle && <p className="text-sm text-[#88958a] mt-1">{subtitle}</p>}</div><button aria-label="Close dialog" onClick={onClose} className="rounded-xl p-2 hover:bg-[#eff4ed]"><X size={19} /></button></div><div className="px-6 pb-6 pt-5">{children}</div></div></div>;
}
function RecipeDetail({ recipe, defaultEaters, onClose, onNotify }) {
  const [eaters, setEaters] = useState(defaultEaters || 2);
  const [step, setStep] = useState(0);
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef(null);
  const speak = useCallback((index) => {
    if (!('speechSynthesis' in window)) { onNotify('Speech playback is not supported in this browser.', true); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`Step ${index + 1}. ${recipe.steps[index]}`);
    utterance.lang = 'en-IN'; utterance.rate = .92;
    window.speechSynthesis.speak(utterance);
  }, [recipe, onNotify]);
  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (recognition.current) { try { recognition.current.onend = null; recognition.current.stop() } catch {/* ignore */ } recognition.current = null; }
    setListening(false);
  }, []);
  useEffect(() => () => stop(), [stop]);
  const goToStep = index => { const next = Math.max(0, Math.min(recipe.steps.length - 1, index)); setStep(next); if (voiceMode) speak(next); };
  const enableMic = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { onNotify('Speech recognition is not available. Use the buttons to navigate.', true); return; }
    if (recognition.current) return;
    const r = new SpeechRecognition(); r.lang = 'en-IN'; r.continuous = true; r.interimResults = false;
    r.onresult = event => {
      const spoken = event.results[event.results.length - 1][0].transcript.toLowerCase();
      if (spoken.includes('next')) setStep(current => { const next = Math.min(recipe.steps.length - 1, current + 1); speak(next); return next });
      else if (spoken.includes('previous') || spoken.includes('back')) setStep(current => { const next = Math.max(0, current - 1); speak(next); return next });
      else if (spoken.includes('repeat')) setStep(current => { speak(current); return current });
      else if (spoken.includes('stop')) { window.speechSynthesis?.cancel() }
    };
    r.onerror = () => onNotify('Microphone recognition failed or permission was denied.', true);
    r.onend = () => { recognition.current = null; setListening(false) };
    try { r.start(); recognition.current = r; setListening(true); } catch { onNotify('Unable to start speech recognition.', true) }
  };
  return <Modal title={`${recipeIcon(recipe)} ${recipe.name}`} subtitle={`${recipe.category} · Around ${recipe.minutes} minutes`} onClose={() => { stop(); onClose() }}>
    <div className="flex flex-wrap justify-between gap-3 mb-5"><div><Label>People eating</Label><input aria-label="People eating this recipe" className="k-field w-28" type="number" min="1" max="30" value={eaters} onChange={e => setEaters(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></div><div className="bg-[#eaf5ed] rounded-xl px-5 py-3 text-right"><p className="text-xs text-[#6a8974]">Estimated meal calories</p><strong className="text-xl text-[#276849]">~{num(recipe.calories_per_serving * eaters)} kcal</strong><p className="text-[10px] text-[#6c8976]">Illustrative recipe estimate</p></div></div>
    <h3 className="font-bold mb-3">Ingredients for {eaters}</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">{scaleRecipe(recipe, eaters).map(ing => <div className="flex justify-between gap-3 border border-[#edf1ec] bg-[#fbfcfa] rounded-xl px-3 py-2.5 text-sm" key={ing.name}><span>{ing.name}</span><strong>{displayAmount(ing.quantity, ing.unit)}</strong></div>)}</div>
    <div className="flex justify-between gap-3 items-center mb-3"><h3 className="font-bold">Cooking instructions</h3>{!voiceMode && <Button onClick={() => { setVoiceMode(true); speak(0) }}><Volume2 size={16} /> Start voice guide</Button>}</div>
    {voiceMode ? <div className="bg-[#edf6ee] border border-[#cce6d2] rounded-2xl p-5 mb-4"><div className="text-[11px] text-[#4d956a] font-bold tracking-widest uppercase mb-3">Voice Chef · Step {step + 1} of {recipe.steps.length}</div><p className="text-lg font-medium leading-relaxed min-h-24">{recipe.steps[step]}</p><div className="flex flex-wrap gap-2 mt-4"><Button variant="outline" disabled={step === 0} onClick={() => goToStep(step - 1)}><ChevronLeft size={15} /> Previous</Button><Button onClick={() => goToStep(step + 1)} disabled={step === recipe.steps.length - 1}>Next <ChevronRight size={15} /></Button><Button variant="outline" onClick={() => speak(step)}><Volume2 size={15} /> Repeat</Button><Button variant="outline" onClick={() => { stop(); setVoiceMode(false) }}><VolumeX size={15} /> Stop</Button><Button variant="outline" onClick={listening ? stop : enableMic}>{listening ? <MicOff size={15} /> : <Mic size={15} />} {listening ? 'Stop listening' : 'Voice commands'}</Button></div><p className="text-xs mt-4 text-[#6e8b78]">If supported, say “next”, “previous”, or “repeat”. Browser speech recognition may use online services.</p></div> : null}
    <ol className="space-y-3">{recipe.steps.map((s, i) => <li key={i} className={`flex items-start gap-3 p-3 rounded-xl text-sm ${voiceMode && i === step ? 'bg-[#edf6ee]' : 'bg-[#f8faf7]'}`}><span className="w-7 h-7 rounded-full bg-[#e6f1e8] text-[#277251] grid place-items-center shrink-0 font-bold text-xs">{i + 1}</span><span className="pt-1 leading-relaxed">{s}</span></li>)}</ol>
    {/leftover/i.test(recipe.name) && <div className="flex gap-2 text-xs text-amber-800 bg-amber-50 rounded-xl p-3 mt-5"><AlertTriangle size={16} className="shrink-0" /> Only use leftovers with verified safe storage. When in doubt, throw them away.</div>}
  </Modal>;
}

export default function App() {
  const [section, setSection] = useState('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [weekStart, setWeekStart] = useState(() => monday());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [craving, setCraving] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [stockDraft, setStockDraft] = useState(DEFAULT_STOCK);
  const [mealDraft, setMealDraft] = useState({ recipe_id: 1, eaters: 4 });
  const [householdDraft, setHouseholdDraft] = useState({ household_name: '', household_size: 4 });

  const notify = useCallback((message, bad = false) => { setNotice({ message, bad, id: Date.now() }); }, []);
  useEffect(() => { if (!notice) return; const handle = setTimeout(() => setNotice(null), 4200); return () => clearTimeout(handle) }, [notice]);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const start = dateISO(weekStart);
      const [settings, inventory, recipes, plan, dashboard, audit] = await Promise.all([
        api('/settings'), api('/inventory'), api('/recipes'), api(`/plan?start=${start}&days=7`),
        api('/dashboard'), api(`/stock-check?start=${start}&days=7`)
      ]);
      setData({ settings, inventory, recipes, plan, dashboard, audit });
    } catch (err) { setError(err.message || 'Cannot connect to backend.'); }
    finally { setBusy(false); }
  }, [weekStart]);
  useEffect(() => { refresh() }, [refresh]);
  const run = async (operation, success) => {
    setBusy(true);
    try { await operation(); setModal(null); notify(success); await refresh(); }
    catch (err) { notify(err.message || 'Something went wrong', true); }
    finally { setBusy(false) }
  };
  const changeSection = id => { setSection(id); setMobileNav(false) };
  const openPlan = (day, mealType) => {
    const existing = data.plan.find(p => p.meal_date === day && p.meal_type === mealType);
    setMealDraft({ recipe_id: existing?.recipe_id || data.recipes[0]?.id, eaters: existing?.eaters || data.settings.household_size });
    setModal({ type: 'plan', day, mealType, existing });
  };
  const openStock = item => {
    setStockDraft(item ? { ...item, expiry_date: item.expiry_date || '', is_leftover: Boolean(item.is_leftover), prepared_at: (item.prepared_at || '').slice(0, 16), storage: item.storage || '' } : { ...DEFAULT_STOCK });
    setModal({ type: 'stock', item });
  };

const saveStock = event => {
  event.preventDefault();

  const allowedDateTypes = [
    "expiry",
    "use_by",
    "best_before",
    "estimated",
    "unknown"
  ];

  const payload = {
    ...stockDraft,
    name: stockDraft.name.trim(),
    quantity: Number(stockDraft.quantity),
    expiry_date: stockDraft.expiry_date || null,
    prepared_at: stockDraft.is_leftover
      ? (stockDraft.prepared_at || null)
      : null,
    storage: stockDraft.is_leftover
      ? (stockDraft.storage || null)
      : null,

    // Preserve scanned metadata for the first batch.
    date_type: allowedDateTypes.includes(stockDraft.date_type)
      ? stockDraft.date_type
      : "unknown",
    date_source: stockDraft.date_source || "manual",
    barcode: stockDraft.barcode || null,
    purchase_date: stockDraft.purchase_date || null,
  };

  return run(
    () => api(
      modal.item
        ? `/inventory/${modal.item.id}`
        : "/inventory",
      {
        method: modal.item ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }
    ),
    modal.item
      ? "Ingredient updated"
      : "Ingredient added to pantry"
  );
};

  const handleSuggestions = async (q) => {
    setBusy(true);
    try { setSuggestions(await api('/suggestions?craving=' + encodeURIComponent(q || ''))); }
    catch (e) { notify(e.message, true) } finally { setBusy(false) }
  };
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateISO(addDays(weekStart, i))), [weekStart]);
  const nameFor = id => data?.recipes.find(r => r.id === id);
  const recipesFiltered = data?.recipes.filter(r => `${r.name} ${r.category} ${r.tags.join(' ')}`.toLowerCase().includes(recipeSearch.toLowerCase())) || [];
  const stockFiltered = data?.inventory.filter(r => r.name.toLowerCase().includes(stockSearch.toLowerCase())) || [];

  const sidebar = <div className="h-full flex flex-col"><div className="flex items-center gap-3 px-4 py-5 mb-5"><div className="rounded-2xl p-3 bg-[#176c51] text-white"><ChefHat size={24} /></div><div><div className="font-extrabold text-[21px] tracking-tight text-[#1e6047]">KitchenSync</div><div className="text-[11px] text-[#95a59a] font-semibold tracking-wide">YOUR SMART KITCHEN</div></div></div>
    <div className="px-4 pb-3 text-[11px] tracking-widest uppercase font-bold text-[#a0ada2]">Workspace</div><nav className="px-2 space-y-1">{SECTIONS.map(([id, label, Icon]) => <button key={id} className={`k-nav ${section === id ? 'is-active' : ''}`} onClick={() => changeSection(id)}><Icon size={18} /><span>{label}</span></button>)}</nav>
    <div className="px-4 mt-8 mb-3 text-[11px] tracking-widest uppercase font-bold text-[#a0ada2]">Project</div><nav className="px-2"><button className={`k-nav ${section === 'roadmap' ? 'is-active' : ''}`} onClick={() => changeSection('roadmap')}><ListChecks size={18} /> Feature roadmap</button></nav>
    <div className="mt-auto px-3 pb-5"><div className="bg-[#e5f3e8] rounded-2xl p-4"><div className="flex gap-2 items-center text-[#327752] font-bold text-sm"><Leaf size={18} /> Made for Indian homes</div><p className="text-[12px] text-[#769582] mt-2 leading-relaxed">Less food waste. Less kitchen stress. More delicious meals.</p></div></div></div>;

  return <div className="min-h-screen lg:flex"><aside className="hidden lg:block fixed inset-y-0 left-0 w-[245px] bg-white border-r border-[#e8eee8] z-20">{sidebar}</aside>
    {mobileNav && <div className="lg:hidden fixed inset-0 z-40 flex"><div className="w-[255px] bg-white h-full z-10">{sidebar}</div><button aria-label="Close menu" className="bg-black/40 flex-1" onClick={() => setMobileNav(false)} /></div>}
    <div className="lg:ml-[245px] w-full min-w-0"><header className="bg-white/90 border-b border-[#e9eee8] h-[76px] flex items-center justify-between gap-3 px-5 md:px-8 sticky top-0 z-10 backdrop-blur-sm"><div className="flex gap-3 items-center"><button className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={23} /></button><span className="text-[#9cab9d] text-sm hidden sm:inline">Workspace /</span><strong className="text-sm text-[#354d3d]">{section === 'roadmap' ? 'Feature roadmap' : SECTIONS.find(s => s[0] === section)?.[1]}</strong></div><div className="flex gap-3 items-center"><span className="hidden sm:inline text-[#87978b] text-xs">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span><button onClick={() => refresh()} aria-label="Refresh data" title="Refresh data" className="p-2.5 rounded-xl hover:bg-[#edf4ed] text-[#5f816b]"><RefreshCcw size={17} className={busy ? 'animate-spin' : ''} /></button><button className="flex gap-2 items-center rounded-xl border border-[#e3ece2] px-3 py-2 hover:bg-[#f6f9f5]" onClick={() => { if (data) { setHouseholdDraft({ ...data.settings }); setModal({ type: 'settings' }) } }}><UsersRound size={17} className="text-[#3f8c66]" /><span className="hidden md:inline text-xs font-semibold">{data?.settings.household_name || 'Household'}</span><Settings2 size={15} className="text-[#98a59a]" /></button></div></header>
      <main className="max-w-[1500px] mx-auto px-5 md:px-8 py-7 md:py-9">
        {error && <div className="k-card p-6 mb-6 flex flex-wrap items-center gap-3"><AlertTriangle className="text-red-600" /><div className="flex-1"><strong>Backend connection problem</strong><p className="text-sm text-red-600">{error}</p><p className="text-xs text-[#69796c]">Start FastAPI on port 8000, then refresh this page.</p></div><Button onClick={refresh}><RefreshCcw size={16} /> Retry</Button></div>}
        {!data && !error ? <div className="k-card p-12 text-center"><RefreshCcw className="mx-auto animate-spin text-[#428661]" /><p className="mt-3 text-sm text-[#779381]">Connecting to your kitchen...</p></div> : data && <>
          {section === 'dashboard' && <>
            <div className="block md:hidden">
              <MobileDashboard
                data={data}
                onNavigate={changeSection}
                onPlan={(mealType) => openPlan(todayISO(), mealType)}
              />
            </div>

            <div className="hidden md:block">

            <SectionHeading eyebrow="Your kitchen at a glance" title="Good food begins here." description="Your household, meals and pantry — all in one calm place." action={<Button onClick={() => openPlan(todayISO(), 'dinner')}><Plus size={17} /> Plan tonight's dinner</Button>} />
            <div className="k-hero rounded-[24px] px-6 md:px-9 py-8 mb-6 flex justify-between items-center overflow-hidden"><div><div className="text-[#b9e6cb] text-[11px] tracking-[.18em] font-semibold uppercase mb-3">A little smarter, every day</div><h2 className="text-2xl md:text-3xl font-bold leading-snug">Your kitchen, in harmony.<br />Less planning. More living.</h2><p className="max-w-lg text-[#d8efe1] text-sm mt-3 mb-5">Plan family meals, discover new recipes and find out what's missing before you start cooking.</p><Button variant="outline" className="!border-transparent" onClick={() => changeSection('planner')}>Open meal planner <ArrowRight size={15} /></Button></div><div className="text-[84px] hidden sm:block pr-2 rotate-[-9deg]" aria-hidden>🥘</div></div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mb-6">
              {[[UsersRound, 'Family members', data.settings.household_size], [CalendarDays, 'Meals planned', data.dashboard.planned_meals], [Package, 'Pantry ingredients', data.dashboard.stock_items], [ShoppingBasket, 'Items to buy', data.dashboard.shopping_count]].map(([Icon, label, value]) => <div className="k-card p-4 md:p-5" key={label}><div className="flex items-center justify-between gap-3 mb-3"><span className="text-xs text-[#819084]">{label}</span><span className="k-stat-icon shrink-0"><Icon size={19} /></span></div><div className="text-3xl font-extrabold tracking-tight text-[#244934]">{value}</div></div>)}
            </div>
            <div className="grid lg:grid-cols-5 gap-5">
              <section className="k-card lg:col-span-3 p-5 md:p-6"><div className="flex justify-between gap-4 items-center mb-5"><div><h3 className="text-lg font-bold">Today's menu</h3><p className="text-xs text-[#819185] mt-1">{prettyDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><button className="text-xs text-[#297a58] font-bold" onClick={() => changeSection('planner')}>View planner →</button></div>
                {MEALS.map(slot => { const meal = data.dashboard.today_meals.find(m => m.meal_type === slot); return <div className="flex items-center gap-3 py-3 border-t border-[#eff2ec]" key={slot}><div className="bg-[#eff5ec] w-12 h-12 flex items-center justify-center rounded-xl text-xl">{slot === 'breakfast' ? '🥣' : slot === 'lunch' ? '🍛' : '🍲'}</div><div className="min-w-0 flex-1"><div className="text-[11px] text-[#91a094] capitalize">{slot}</div><div className="font-bold text-sm truncate">{meal?.recipe_name || 'Not planned yet'}</div><div className="text-xs text-[#9aab9d]">{meal ? `${meal.eaters} people · ${meal.minutes} min` : 'Tap to add a meal'}</div></div>{meal ? <Tag tone={meal.completed_at ? 'green' : 'orange'}>{meal.completed_at ? 'Cooked' : 'Planned'}</Tag> : <Button variant="outline" onClick={() => openPlan(todayISO(), slot)}><Plus size={15} /> Add</Button>}</div> })}
              </section>
              <section className="k-card lg:col-span-2 p-5 md:p-6"><div className="flex justify-between items-center mb-5 gap-2"><div><h3 className="text-lg font-bold">Kitchen alerts</h3><p className="text-xs text-[#859587] mt-1">Shortages and expiry reminders</p></div><AlertTriangle size={20} className="text-[#d89c42]" /></div>
                {data.dashboard.expired_or_unsafe.length + data.dashboard.expiring_soon.length + data.dashboard.missing_alerts.length === 0 ? <EmptyState icon={CheckCircle2}>You're all caught up!</EmptyState> : <div className="space-y-3">{data.dashboard.expired_or_unsafe.slice(0, 2).map(item => <div className="flex gap-3 p-3 bg-red-50 rounded-xl" key={'unsafe' + item.id}><AlertTriangle size={17} className="text-red-600 shrink-0" /><div className="text-xs"><strong>{item.name}</strong><p className="text-red-700 mt-1">Expired or unsafe leftover — review before use</p></div></div>)}{data.dashboard.expiring_soon.slice(0, 2).map(item => <div className="flex gap-3 p-3 bg-amber-50 rounded-xl" key={'exp' + item.id}><Clock3 size={17} className="text-amber-600 shrink-0" /><div className="text-xs"><strong>{item.name} expires soon</strong><p className="text-amber-700 mt-1">Expiry: {item.expiry_date}</p></div></div>)}{data.dashboard.missing_alerts.slice(0, 4).map((alert, i) => <div className="flex gap-3 p-3 bg-[#f8f8f3] rounded-xl" key={i}><ShoppingBasket size={17} className="text-[#d49c4c] shrink-0" /><div className="text-xs"><strong>Need {displayAmount(alert.missing, alert.unit)} {alert.ingredient}</strong><p className="text-[#8a9688] mt-1">{alert.recipe} · {prettyDate(alert.date)}</p></div></div>)}</div>}
                <button className="mt-5 text-xs text-[#297a58] font-bold" onClick={() => changeSection('shopping')}>Review shopping list →</button>
              </section>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mt-5"><button onClick={() => changeSection('assistant')} className="text-left k-card p-5 hover:border-[#b4d6bb] transition"><div className="flex items-center gap-2 font-bold"><Sparkles size={19} className="text-[#3c9471]" /> What should I cook?</div><p className="text-xs text-[#8a978b] mt-2">Discover recipes that match your current stock and cravings.</p></button><button onClick={() => changeSection('inventory')} className="text-left k-card p-5 hover:border-[#b4d6bb] transition"><div className="flex items-center gap-2 font-bold"><Package size={19} className="text-[#3c9471]" /> Manage pantry</div><p className="text-xs text-[#8a978b] mt-2">Add groceries, edit quantities and monitor expiry dates.</p></button></div>
            </div>  {/* Close desktop dashboard */}
          </>}

          {section === 'planner' && <>

            {/* Mobile Meal Planner */}
            <div className="md:hidden">
              <MobileMealPlanner
                dates={dates}
                plan={data.plan}
                recipes={data.recipes}
                audit={data.audit}
                onPlan={openPlan}
                onViewRecipe={(recipeId) => {
                  const recipe = nameFor(recipeId);
                  if (recipe) {
                    setModal({ type: "recipe", recipe });
                  }
                }}
                onWeekChange={(offset) =>
                  setWeekStart(addDays(weekStart, offset * 7))
                }
                onThisWeek={() => setWeekStart(monday())}
                onShopping={() => changeSection("shopping")}
              />
            </div>

            {/* Existing Desktop Meal Planner */}
            <div className="hidden md:block">

            <SectionHeading eyebrow="Meal planning" title="Your weekly meal calendar" description="Set breakfast, lunch and dinner. Each meal has its own number of people eating." action={<div className="flex gap-2"><Button variant="outline" onClick={() => setWeekStart(monday())}>This week</Button><Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft size={17} /></Button><Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight size={17} /></Button></div>} />
            <div className="flex justify-between flex-wrap gap-3 items-center mb-4"><p className="text-sm font-semibold text-[#427356]">{prettyDate(dates[0])} – {prettyDate(dates[6])}</p><span className="text-xs text-[#819286]">Click a meal to plan or change it · Stock check below</span></div>
            <div className="overflow-x-auto k-scroll pb-2"><div className="grid k-grid-days gap-3 min-w-[1060px]">{dates.map(day => <div key={day} className="k-card p-3"><div className={`rounded-xl px-3 py-3 mb-3 ${day === todayISO() ? 'bg-[#dff0e5]' : 'bg-[#f8faf7]'}`}><div className="text-xs font-bold text-[#7d9583]">{prettyDate(day, { weekday: 'long' })}</div><div className="text-2xl font-bold text-[#316448]">{new Date(day + 'T12:00:00').getDate()}</div></div>{MEALS.map(slot => { const p = data.plan.find(m => m.meal_date === day && m.meal_type === slot); return <button key={slot} onClick={() => p?.completed_at ? setModal({ type: 'recipe', recipe: nameFor(p.recipe_id) }) : openPlan(day, slot)} className={`text-left w-full rounded-xl p-3 mb-2 border min-h-[115px] transition hover:border-[#a7d6b2] ${p ? 'bg-[#f8fbf5] border-[#e2eee4]' : 'border-dashed border-[#dfeadf]'}`}><div className="flex justify-between gap-1 text-[11px] font-semibold capitalize text-[#8b9a8d] mb-2">{slot}{p?.completed_at && <Check size={14} className="text-green-600" />}</div><div className="text-[13px] font-bold leading-tight">{p ? p.recipe_name : '+ Add meal'}</div>{p && <p className="text-[11px] mt-2 text-[#97a59a]">{p.eaters} eating</p>}</button> })}</div>)}</div></div>
            <div className="grid lg:grid-cols-3 gap-4 mt-5"><div className="k-card lg:col-span-2 p-5"><h3 className="font-bold mb-2">Weekly ingredient shortage check</h3><p className="text-xs text-[#839587] mb-3">Ingredients are allocated across meals in chronological order; stock isn't counted twice.</p>{data.audit.warnings.length ? <div className="space-y-2 max-h-[250px] overflow-auto k-scroll">{data.audit.warnings.slice(0, 12).map((w, i) => <div key={i} className="flex justify-between gap-3 text-xs bg-[#fff6e7] p-3 rounded-lg"><span>{prettyDate(w.date)} · {w.recipe}</span><strong className="text-[#926b2c]">{w.ingredient}: {displayAmount(w.missing, w.unit)}</strong></div>)}</div> : <Tag tone="green">All currently planned meals have enough stock</Tag>}</div><div className="k-card p-5 flex flex-col justify-between"><div><h3 className="font-bold mb-3">Shopping needs</h3><strong className="text-4xl text-[#276d50]">{data.audit.shopping.length}</strong><p className="text-xs text-[#89998b] mt-2">Ingredient types missing this week</p></div><Button className="mt-5" onClick={() => changeSection('shopping')}>View shopping list <ArrowRight size={16} /></Button></div></div>
          </div>
          </>}
          {section === 'recipes' && <>


            {/* Mobile Recipe Library */}
            <div className="md:hidden">
              <MobileRecipeLibrary
                recipes={data.recipes}
                inventory={data.inventory}
                householdSize={data.settings.household_size}
                onOpenRecipe={(recipe) =>
                  setModal({ type: "recipe", recipe })
                }
                onNavigate={changeSection}
              />
            </div>

            {/* Existing Desktop Recipe Library */}
            <div className="hidden md:block">

            <SectionHeading eyebrow="Find your next favourite" title="Recipe library" description="Browse familiar Indian meals, scale portions and get hands-free cooking guidance." action={<Button variant="light" onClick={() => changeSection('assistant')}><Sparkles size={16} /> Find from my stock</Button>} />
            <div className="relative mb-5"><Search size={19} className="absolute left-4 top-[13px] text-[#91a499]" /><input className="k-field pl-12" placeholder="Search paneer, breakfast, quick meals..." value={recipeSearch} onChange={e => setRecipeSearch(e.target.value)} /></div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{recipesFiltered.map(r => <article className="k-card overflow-hidden flex flex-col" key={r.id}><div className="h-36 flex items-center justify-center text-[70px] relative bg-gradient-to-br from-[#f1f6e8] to-[#e9f3df]">{recipeIcon(r)}<span className="absolute top-3 right-3"><Tag tone="green">{r.category}</Tag></span></div><div className="p-5 flex-1 flex flex-col"><h3 className="text-lg font-bold">{r.name}</h3><div className="flex flex-wrap gap-2 mt-3 text-xs text-[#819183]"><span className="flex items-center gap-1"><Clock3 size={14} /> {r.minutes} min</span><span className="flex items-center gap-1"><UsersRound size={14} /> {r.base_servings} servings</span><span>~{num(r.calories_per_serving)} kcal/serving*</span></div><div className="flex flex-wrap gap-2 mt-3 mb-5">{r.tags.slice(0, 3).map(tag => <Tag key={tag}>{tag}</Tag>)}</div><Button className="mt-auto w-full" onClick={() => setModal({ type: 'recipe', recipe: r })}>See ingredients & cook <ArrowRight size={15} /></Button></div></article>)}</div>
            {!recipesFiltered.length && <EmptyState icon={Search}>No recipes match this search.</EmptyState>}
            <p className="text-xs text-[#9baa9b] mt-5">* Calories and recipe quantities are illustrative demo estimates, not a verified nutrition database.</p>
            </div>
          </>}
          {section === 'inventory' && <>

            {/* Mobile Pantry Overview */}
            <div className="md:hidden">

              <MobilePantry
                inventory={data.inventory}
                dashboard={data.dashboard}
                onManage={() =>
                  document.getElementById("inventory-controls")
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    })
                }


            onScanConfirmed={(result) => {
              setStockDraft({
                ...DEFAULT_STOCK,
                name: result.name || "",
                expiry_date: result.expiry_date || "",
                quantity: 0,
                unit: "g",

                // Preserve scanned information
                date_type: result.date_type || "unknown",
                date_source: result.date_source || "user_confirmed",
                barcode: result.barcode || "",
                purchase_date: result.purchase_date || "",
              });

              setModal({
                type: "stock",
                item: null,
              });
            }}
              />

            </div>

            {/* Existing Inventory Controls */}
            <div id="inventory-controls" className="scroll-mt-6">

            <SectionHeading eyebrow="Pantry & freshness" title="My kitchen inventory" description="Keep ingredients accurate. Quantities are stored in grams, millilitres or pieces; expiry warnings appear automatically." action={<Button onClick={() => openStock(null)}><Plus size={17} /> Add ingredient</Button>} />
            <div className="k-card p-4 mb-5 flex flex-wrap gap-3 items-center justify-between"><div className="relative w-full sm:max-w-sm"><Search size={18} className="absolute top-3 left-3.5 text-[#9ba99c]" /><input value={stockSearch} onChange={e => setStockSearch(e.target.value)} className="k-field pl-11" placeholder="Find an ingredient..." /></div><div className="text-xs text-[#8fa092]">{data.inventory.length} ingredients · Includes manually entered stock</div></div>
            <div className="k-card overflow-x-auto k-scroll"><table className="w-full text-sm text-left min-w-[620px]"><thead className="bg-[#f7faf5] text-[#819386] text-xs"><tr><th className="p-4 font-semibold">Ingredient</th><th className="p-4 font-semibold">Quantity</th><th className="p-4 font-semibold">Expiry</th><th className="p-4 font-semibold">Status</th><th className="p-4 font-semibold text-right">Actions</th></tr></thead><tbody>{stockFiltered.map(item => <tr key={item.id} className="border-t border-[#edf1eb] hover:bg-[#fcfefa]"><td className="p-4"><strong>{item.name}</strong>{Boolean(item.is_leftover) && <div className="text-xs text-[#aa8c49] mt-1">Cooked leftover</div>}</td><td className="p-4 font-semibold">{displayAmount(item.quantity, item.unit)}</td><td className="p-4 text-[#819486]">{item.expiry_date ? prettyDate(item.expiry_date) : 'Not set'}</td><td className="p-4"><Tag tone={!item.usable ? 'red' : item.quantity <= 0 ? 'orange' : 'green'}>{!item.usable ? 'Review / unsafe' : item.quantity <= 0 ? 'Out of stock' : 'Available'}</Tag></td><td className="p-4"><div className="flex justify-end gap-2"><button title="Edit" className="p-2 text-[#438866] bg-[#eef6ef] rounded-lg" onClick={() => openStock(item)}><Pencil size={16} /></button><button title="Delete" className="p-2 text-red-600 bg-red-50 rounded-lg" onClick={() => { if (window.confirm(`Delete ${item.name} from pantry?`)) run(() => api(`/inventory/${item.id}`, { method: 'DELETE' }), `${item.name} removed`) }}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{!stockFiltered.length && <EmptyState icon={Package}>No matching ingredients.</EmptyState>}</div>
            <p className="text-xs text-[#899b8c] mt-4">Note: Leftover storage checks are conservative demo rules, not a guarantee of food safety. The app never assumes unrefrigerated overnight rice is safe.</p>
            </div>
          </>}
          {section === 'shopping' && (
            <MobileShopping
              shopping={data.audit.shopping}
              inventory={data.inventory}
              weekStart={dateISO(weekStart)}
              onRefresh={refresh}
              onNotify={notify}
            />
          )}
          {section === 'assistant' && <>
            <AIRecipeFinder />
            <SectionHeading eyebrow="Your recipe companion" title="What should we cook today?" description="Tell us what you're craving. The current demo recommends from eight local recipes using your pantry stock." />
            <div className="k-card p-5 md:p-7 max-w-4xl"><div className="flex gap-3 items-center mb-4"><div className="bg-[#e9f4ed] rounded-xl p-3 text-[#2c8764]"><Bot size={24} /></div><div><h3 className="font-bold">KitchenSync Recipe Finder</h3><p className="text-xs text-[#8b9b8e]">Offline stock-aware ranking · Not yet a connected LLM</p></div></div><form onSubmit={e => { e.preventDefault(); handleSuggestions(craving) }} className="flex flex-col sm:flex-row gap-3"><input className="k-field flex-1" value={craving} onChange={e => setCraving(e.target.value)} placeholder="e.g. something spicy, quick dinner, rice..." /><Button disabled={busy} type="submit"><Sparkles size={17} /> Find recipes</Button></form><div className="flex gap-2 flex-wrap mt-4">{['spicy', 'quick', 'breakfast', 'rice', 'leftovers'].map(tag => <button key={tag} onClick={() => { setCraving(tag); handleSuggestions(tag) }} className="rounded-full bg-[#f1f7ee] text-[#527e60] px-3 py-1.5 text-xs font-semibold hover:bg-[#e5f1e3]">{tag}</button>)}</div>
              {suggestions && <div className="mt-7"><h4 className="font-bold mb-3">Recipes to consider</h4><div className="space-y-3">{suggestions.results.map(item => <div key={item.recipe.id} className="flex gap-3 items-center p-4 rounded-xl border border-[#e5eee4]"><span className="text-3xl">{recipeIcon(item.recipe)}</span><div className="flex-1 min-w-0"><h5 className="font-bold text-sm">{item.recipe.name}</h5><p className="text-xs text-[#8da18f] mt-1">{item.covered}/{item.total} ingredients fully available for 2 people</p></div><Button variant="light" onClick={() => setModal({ type: 'recipe', recipe: item.recipe })}>View <ArrowRight size={14} /></Button></div>)}</div></div>}
            </div><div className="max-w-4xl mt-5 border border-[#eedebf] bg-[#fffaf0] p-4 rounded-2xl text-sm text-[#987646] flex gap-3"><Info className="shrink-0" size={19} /><span>Natural-language AI conversations, external recipe search and voice Q&A will be connected in a later milestone. This screen currently searches the local recipe library without inventing external results.</span></div>
          </>}
          {section === 'roadmap' && <>
            <SectionHeading eyebrow="Living feature plan" title="KitchenSync build roadmap" description="Features are integrated step by step. New ideas can be added without losing the working core." />
            <div className="k-card p-5 md:p-7 max-w-4xl"><div className="grid sm:grid-cols-2 gap-3">{CAPABILITIES.map(([name, status]) => <div className="p-3 rounded-xl border border-[#e6eee4] flex justify-between items-center gap-3" key={name}><span className="text-sm font-medium">{name}</span><Tag tone={status === 'Available' ? 'green' : status === 'Planned' ? 'orange' : 'muted'}>{status}</Tag></div>)}</div></div>
            <div className="max-w-4xl grid md:grid-cols-3 gap-4 mt-5">{[['1', 'Build reliable core', 'Inventory, recipes, plan, shopping, deduction'], ['2', 'Make cooking intelligent', 'External recipes, real AI, Hindi and English voice'], ['3', 'Automate purchases & leftovers', 'Receipts, verified live prices, leftover tracking']].map(([n, title, body]) => <div className="k-card p-5" key={n}><div className="text-3xl font-extrabold text-[#9ecfac]">{n}</div><h3 className="font-bold my-2">{title}</h3><p className="text-xs leading-relaxed text-[#87998b]">{body}</p></div>)}</div>
          </>}
        </>}
      </main>
      <footer className="text-center text-[11px] text-[#9aab9c] px-6 pb-6">KitchenSync MVP · Built for learning and hackathon demonstration · Sample recipe nutrition is approximate</footer>
    </div>
    {notice && <div className={`fixed z-[100] bottom-5 right-5 max-w-md shadow-xl px-5 py-4 rounded-xl text-sm font-semibold text-white ${notice.bad ? 'bg-[#bc5353]' : 'bg-[#206b51]'}`} role="status">{notice.message}</div>}

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        section={section}
        onNavigate={changeSection}
      />





    {modal?.type === 'recipe' && (
      <MobileRecipeDetail
        recipe={modal.recipe}
        defaultEaters={data?.settings.household_size || 2}
        inventory={data?.inventory || []}
        onClose={() => setModal(null)}
        onNotify={notify}
      />
    )}


    {modal?.type === 'settings' && <Modal title="Household settings" subtitle="Manage your family default serving size" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); run(() => api('/settings', { method: 'PUT', body: JSON.stringify({ household_name: householdDraft.household_name, household_size: Number(householdDraft.household_size) }) }), 'Household updated') }} className="space-y-4"><div><Label>Household name</Label><input className="k-field" value={householdDraft.household_name} required maxLength={80} onChange={e => setHouseholdDraft({ ...householdDraft, household_name: e.target.value })} /></div><div><Label>Default family size (1–30)</Label><input type="number" className="k-field" min="1" max="30" required value={householdDraft.household_size} onChange={e => setHouseholdDraft({ ...householdDraft, household_size: e.target.value })} /></div><p className="text-xs text-[#829688]">Every planned meal can override this number when some people are away.</p><div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setModal(null)}>Cancel</Button><Button disabled={busy} type="submit">Save settings</Button></div></form></Modal>}
    {modal?.type === 'stock' && <Modal title={modal.item ? 'Edit ingredient' : 'Add to pantry'} subtitle="Changes are saved to your local KitchenSync database" onClose={() => setModal(null)}><form onSubmit={saveStock} className="space-y-4"><div><Label>Ingredient name</Label><input className="k-field" placeholder="e.g. Potato" maxLength={80} required value={stockDraft.name} onChange={e => setStockDraft({ ...stockDraft, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Quantity</Label><input className="k-field" type="number" step="0.01" min="0" max="1000000" required value={stockDraft.quantity} onChange={e => setStockDraft({ ...stockDraft, quantity: e.target.value })} /></div><div><Label>Unit</Label><select className="k-field" value={stockDraft.unit} onChange={e => setStockDraft({ ...stockDraft, unit: e.target.value })}><option value="g">grams (g)</option><option value="ml">millilitres (ml)</option><option value="pcs">pieces (pcs)</option></select></div></div><div><Label>Expiry / best-before date (optional)</Label><input className="k-field" type="date" value={stockDraft.expiry_date} onChange={e => setStockDraft({ ...stockDraft, expiry_date: e.target.value })} /></div><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={stockDraft.is_leftover} onChange={e => setStockDraft({ ...stockDraft, is_leftover: e.target.checked })} /> Cooked leftover food</label>{stockDraft.is_leftover && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><Label>Prepared at</Label><input required type="datetime-local" className="k-field" value={stockDraft.prepared_at} onChange={e => setStockDraft({ ...stockDraft, prepared_at: e.target.value })} /></div><div><Label>Storage</Label><select className="k-field" required value={stockDraft.storage} onChange={e => setStockDraft({ ...stockDraft, storage: e.target.value })}><option value="">Select storage...</option><option value="refrigerated">Refrigerated</option><option value="room_temperature">Room temperature</option><option value="frozen">Frozen</option></select></div></div>}<p className="text-xs text-[#87998b]">Convert 1 kg to 1000 g or 1 L to 1000 ml. Leftover safety needs personal verification.</p><div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setModal(null)}>Cancel</Button><Button disabled={busy} type="submit">Save ingredient</Button></div></form></Modal>}
    {modal?.type === 'plan' && <Modal title={`${modal.existing ? 'Edit' : 'Plan'} ${modal.mealType}`} subtitle={prettyDate(modal.day, { weekday: 'long', day: 'numeric', month: 'long' })} onClose={() => setModal(null)}><form className="space-y-4" onSubmit={e => { e.preventDefault(); run(() => api(`/plan/${modal.day}/${modal.mealType}`, { method: 'PUT', body: JSON.stringify({ recipe_id: Number(mealDraft.recipe_id), eaters: Number(mealDraft.eaters) }) }), 'Meal plan saved') }}><div><Label>Choose recipe</Label><select className="k-field" value={mealDraft.recipe_id} onChange={e => setMealDraft({ ...mealDraft, recipe_id: Number(e.target.value) })}>{data.recipes.map(r => <option value={r.id} key={r.id}>{r.name}</option>)}</select></div><div><Label>People eating this meal</Label><input type="number" className="k-field" min="1" max="30" required value={mealDraft.eaters} onChange={e => setMealDraft({ ...mealDraft, eaters: e.target.value })} /></div>{nameFor(Number(mealDraft.recipe_id)) && <div className="bg-[#f3f8f1] rounded-xl p-4 text-sm"><div className="flex justify-between"><strong>Estimated total calories</strong><strong>~{num(nameFor(Number(mealDraft.recipe_id)).calories_per_serving * Number(mealDraft.eaters || 1))} kcal</strong></div><p className="text-xs text-[#829486] mt-2">Sample estimate. Ingredients scale automatically.</p></div>}
      <div className="flex flex-wrap justify-between gap-2"><div className="flex flex-wrap gap-2">{modal.existing && !modal.existing.completed_at && <Button type="button" variant="danger" onClick={() => { if (window.confirm('Remove this planned meal?')) run(() => api(`/plan/${modal.day}/${modal.mealType}`, { method: 'DELETE' }), 'Meal removed') }}><Trash2 size={15} /> Remove</Button>}{modal.existing && !modal.existing.completed_at && <Button type="button" variant="light" onClick={() => { if (window.confirm('Mark as cooked? Ingredient quantities will be deducted once.')) run(() => api(`/plan/${modal.day}/${modal.mealType}/complete`, { method: 'POST' }), 'Meal completed; inventory updated') }}><CheckCircle2 size={15} /> Mark cooked</Button>}</div><Button disabled={busy || Boolean(modal.existing?.completed_at)} type="submit">Save meal</Button></div></form></Modal>}
  </div>;
}
