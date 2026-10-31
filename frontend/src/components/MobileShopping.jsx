import PriceComparison from './PriceComparison.jsx';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, CheckCircle2, ClipboardCopy, PackagePlus,
  RefreshCw, ShoppingBasket, ShoppingCart, X,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  amountLabel, checklistKey, makePurchaseRequest, normalizedShoppingRows, purchaseDateWarning,
} from '../lib/shoppingUtils';
import './MobileShopping.css';

function readChecklist(weekStart) {
  try {
    const value = JSON.parse(localStorage.getItem(checklistKey(weekStart)) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export default function MobileShopping({
  shopping = [],
  inventory = [],
  weekStart,
  onRefresh,
  onNotify,
}) {
  const rows = useMemo(() => normalizedShoppingRows(shopping), [shopping]);
  const [checked, setChecked] = useState(() => readChecklist(weekStart));
  const [expanded, setExpanded] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [dateType, setDateType] = useState('expiry');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setChecked(readChecklist(weekStart));
    setExpanded(null);
    setMessage('');
    setError('');
  }, [weekStart]);

  const purchasedCount = rows.filter((row) => Boolean(checked[row.key])).length;
  const dateWarning = purchaseDateWarning(dateValue);

  function toggleChecked(key) {
    const updated = { ...checked, [key]: !checked[key] };
    setChecked(updated);
    try {
      localStorage.setItem(checklistKey(weekStart), JSON.stringify(updated));
    } catch {
      setError('Checklist status could not be stored on this device.');
    }
  }

  function openPurchase(row) {
    setExpanded((current) => current === row.key ? null : row.key);
    setQuantity(String(row.missing));
    setDateValue('');
    setDateType('expiry');
    setDateConfirmed(false);
    setError('');
    setMessage('');
  }

  async function refreshNow() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      await onRefresh();
    } catch (err) {
      setError(err?.message || 'Could not refresh shopping shortages.');
    } finally {
      setRefreshing(false);
    }
  }

  async function copyList() {
    try {
      const items = rows.filter((row) => !checked[row.key]);
      if (!items.length) {
        setMessage('There are no unchecked items to copy.');
        return;
      }
      await navigator.clipboard.writeText(
        items.map((row) => `${row.name}: ${amountLabel(row.missing, row.unit)}`).join('\n')
      );
      setMessage('Unchecked shopping items copied.');
      onNotify?.('Shopping list copied');
    } catch {
      setError('Clipboard access is unavailable. Copy the items manually.');
    }
  }

  async function savePurchase(event, row) {
    event.preventDefault();
    if (saving) return;
    if (dateWarning && !dateConfirmed) {
      setError('Confirm the unusual printed date before saving the purchase.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const request = makePurchaseRequest(row, inventory, quantity, dateValue, dateType);
      await api(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });
      // The backend creates a batch for an existing ingredient, or creates
      // a new ingredient with its first batch. Never overwrite total stock.
      setExpanded(null);
      setMessage(`${row.name}: ${amountLabel(quantity, row.unit)} saved to Pantry. Shortages are being refreshed.`);
      onNotify?.(`${row.name} added to Pantry`);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setError(err?.message || 'Could not save the purchase. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ks-shopping" aria-label="Smart shopping list">
      <header className="ks-shopping-header">
        <div>
          <span className="ks-shopping-eyebrow">YOUR WEEKLY SHOPPING</span>
          <h1>Smart Shopping <span aria-hidden="true">🛒</span></h1>
          <p>Based on the meal plan and usable Pantry stock — not guessed quantities.</p>
        </div>
        <div className="ks-shopping-icon"><ShoppingCart size={25} /></div>
      </header>

      <div className="ks-shopping-stats">
        <div className="ks-shopping-stat"><strong>{rows.length}</strong><span>Ingredients needed</span></div>
        <div className="ks-shopping-stat"><strong>{purchasedCount}</strong><span>Marked purchased</span></div>
        <div className="ks-shopping-stat"><strong>{rows.length - purchasedCount}</strong><span>Still on list</span></div>
      </div>

      {error && <div className="ks-shopping-feedback ks-shopping-error" role="alert"><AlertCircle size={18}/>{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {message && <div className="ks-shopping-feedback ks-shopping-success" role="status"><CheckCircle2 size={18}/>{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss message"><X size={16}/></button></div>}

      <div className="ks-shopping-toolbar">
        <div>
          <h2>Ingredients to buy</h2>
          <p>{weekStart ? `Week starting ${weekStart}` : 'Current meal-plan week'} · Live shortages from KitchenSync</p>
        </div>
        <div className="ks-shopping-toolbar-actions">
          <button type="button" onClick={copyList} disabled={!rows.length} className="ks-shopping-btn ks-shopping-btn-light"><ClipboardCopy size={16}/> Copy list</button>
          <button type="button" onClick={refreshNow} disabled={saving || refreshing} className="ks-shopping-btn ks-shopping-btn-light"><RefreshCw size={16} className={refreshing ? 'ks-shopping-spin' : ''}/> {refreshing ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>

      {!rows.length ? (
        <div className="ks-shopping-empty"><CheckCircle2 size={36}/><h3>You're stocked for the week!</h3><p>No missing ingredients were reported for the selected meal-plan week. Change your plan or refresh to see new needs.</p></div>
      ) : (
        <div className="ks-shopping-list">
          {rows.map((row) => (
            <article key={row.key} className={`ks-shopping-item ${checked[row.key] ? 'ks-shopping-item-checked' : ''}`}>
              <div className="ks-shopping-item-main">
                <label className="ks-shopping-check">
                  <input type="checkbox" checked={Boolean(checked[row.key])} onChange={() => toggleChecked(row.key)} />
                  <span aria-hidden="true" className="ks-shopping-check-mark">{checked[row.key] && <Check size={15}/>}</span>
                  <span className="ks-shopping-name">{row.name}</span>
                </label>
                <div className="ks-shopping-quantity">
                  <strong>{amountLabel(row.missing, row.unit)}</strong>
                  <small>to buy</small>
                </div>
              </div>
              <div className="ks-shopping-subline">
                <span>Meal plan: {amountLabel(row.required, row.unit)}</span>
                <span>Usable stock: {amountLabel(row.available, row.unit)}</span>
              </div>
              <div className="ks-shopping-item-actions">
                <span className="ks-shopping-checked-label">{checked[row.key] ? 'Marked purchased · not yet added automatically' : 'Still needed'}</span>
                <button type="button" className="ks-shopping-btn ks-shopping-btn-primary" onClick={() => openPurchase(row)} disabled={saving && expanded !== row.key} aria-expanded={expanded === row.key}>
                  <PackagePlus size={16}/> {expanded === row.key ? 'Close form' : 'Add to Pantry'}
                </button>
              </div>
              {expanded === row.key && (
                <form className="ks-shopping-purchase" onSubmit={(event) => savePurchase(event, row)} aria-busy={saving}>
                  <div className="ks-shopping-help">Confirm how much you actually bought. This creates a new purchase batch, not an overwrite of your existing stock.</div>
                  <div className="ks-shopping-form-grid">
                    <label>Purchased quantity ({row.unit})
                      <input autoFocus required type="number" min="0.01" max="1000000" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)}/>
                    </label>
                    <label>Printed date (optional)
                      <input type="date" value={dateValue} onChange={(event) => { setDateValue(event.target.value); setDateConfirmed(false); }}/>
                    </label>
                    {dateValue && <label>Date type
                      <select value={dateType} onChange={(event) => setDateType(event.target.value)}>
                        <option value="expiry">Expiry date</option>
                        <option value="use_by">Use-by date</option>
                        <option value="best_before">Best-before date</option>
                      </select>
                    </label>}
                  </div>
                  {dateWarning && (
                    <div className="ks-shopping-date-warning" role="alert">
                      <AlertCircle size={18} aria-hidden="true" />
                      <div>
                        <p>{dateWarning}</p>
                        <label className="ks-shopping-date-confirm">
                          <input type="checkbox" checked={dateConfirmed} onChange={(event) => setDateConfirmed(event.target.checked)} />
                          I checked the printed date and want to save it as entered.
                        </label>
                      </div>
                    </div>
                  )}
                  <p className="ks-shopping-helper-text">No printed date? Leave it blank. KitchenSync won't invent an expiry date.</p>
                  <button type="submit" disabled={saving || Boolean(dateWarning && !dateConfirmed)} className="ks-shopping-btn ks-shopping-btn-primary ks-shopping-submit">
                    <PackagePlus size={16}/>{saving ? 'Saving purchase...' : 'Confirm and save purchase'}
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
      <footer className="ks-shopping-footer">
        <ShoppingBasket size={18}/>
        <p><strong>Checklist status is stored only in this browser.</strong> Marking purchased doesn't change stock. Saving a purchase updates SQLite and triggers a shortage refresh.</p>
      </footer>
      <PriceComparison rows={rows} />
    </section>
  );
}
