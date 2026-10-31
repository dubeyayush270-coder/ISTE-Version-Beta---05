import { useMemo, useState } from 'react';
import { ArrowDownUp, CheckCircle2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import {
  PRICE_STORAGE_KEY, createManualOffer, formatNormalizedPrice,
  formatRupees, offerKey, packUnitsFor, sortOffersByValue,
} from '../lib/priceUtils';
import './PriceComparison.css';

function loadOffers() {
  try {
    if (typeof window === 'undefined') return [];
    const parsed = JSON.parse(window.localStorage.getItem(PRICE_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((offer) => offer?.source === 'manual').slice(-200) : [];
  } catch {
    return [];
  }
}

const EMPTY_FORM = { store: '', packQuantity: '', packUnit: '', price: '' };

function recordedDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  }) : 'Unknown date';
}

export default function PriceComparison({ rows = [] }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [offers, setOffers] = useState(loadOffers);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const item = rows.find((row) => row.key === selectedKey) || rows[0] || null;
  const itemKey = item ? offerKey(item.name, item.unit) : '';
  const unitOptions = item ? packUnitsFor(item.unit) : [];
  const itemOffers = useMemo(() => sortOffersByValue(offers, itemKey), [offers, itemKey]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function chooseIngredient(event) {
    setSelectedKey(event.target.value);
    resetForm();
    setError('');
    setNotice('');
  }

  function commit(next) {
    try {
      // Prices stay on this device; no price data is sent to the backend.
      window.localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(next));
      setOffers(next);
      return true;
    } catch {
      setError('Browser storage is unavailable or full. Your changes were not saved.');
      return false;
    }
  }

  function saveOffer(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!item) return;
    try {
      const now = new Date().toISOString();
      const id = editingId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const offer = createManualOffer({
        item,
        store: form.store,
        packQuantity: form.packQuantity,
        packUnit: form.packUnit || unitOptions[0]?.value,
        price: form.price,
      }, id, now);
      const next = editingId
        ? offers.map((old) => old.id === editingId ? offer : old)
        : [...offers, offer].slice(-200);
      if (!commit(next)) return;
      setNotice(editingId ? 'Manual price updated.' : 'Manual price saved.');
      resetForm();
    } catch (err) {
      setError(err?.message || 'Please check the package details.');
    }
  }

  function startEditing(offer) {
    setEditingId(offer.id);
    setForm({
      store: offer.store,
      packQuantity: String(offer.packQuantity),
      packUnit: offer.packUnit,
      price: String(offer.price),
    });
    setError('');
    setNotice('');
  }

  function removeOffer(offer) {
    if (!window.confirm(`Remove the manual offer from ${offer.store}?`)) return;
    if (!commit(offers.filter((entry) => entry.id !== offer.id))) return;
    if (editingId === offer.id) resetForm();
    setError('');
    setNotice('Manual offer removed.');
  }

  return (
    <section className="ks-price" aria-label="Manually entered grocery price comparison">
      <div className="ks-price-heading">
        <span className="ks-price-heading-icon"><ArrowDownUp size={20} /></span>
        <div>
          <span className="ks-price-eyebrow">COMPARE BY QUANTITY</span>
          <h2>Grocery Price Comparison</h2>
          <p>Record real prices you find yourself. Every offer here is <strong>manually entered</strong> — not a live store quote.</p>
        </div>
      </div>

      {!item ? (
        <div className="ks-price-empty">No shopping shortages in this week. Price comparison will appear when your meal plan needs ingredients.</div>
      ) : (
        <>
          <label className="ks-price-picker">Ingredient from your shopping list
            <select value={item.key} onChange={chooseIngredient}>
              {rows.map((row) => <option key={row.key} value={row.key}>{row.name} · {row.unit}</option>)}
            </select>
          </label>
          <p className="ks-price-context">Compare packs for <strong>{item.name}</strong> (need {item.missing} {item.unit}). Rates are normalized to {item.unit === 'g' ? '₹/kg' : item.unit === 'ml' ? '₹/L' : '₹/piece'}.</p>

          <form className="ks-price-form" onSubmit={saveOffer}>
            <h3><Tag size={16}/> {editingId ? 'Edit your entered price' : 'Add a price you found'}</h3>
            <div className="ks-price-fields">
              <label>Store / seller
                <input required type="text" maxLength={70} placeholder="e.g. neighbourhood grocery" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} />
              </label>
              <label>Pack quantity
                <input required type="number" min="0.001" max="1000000" step="any" placeholder="e.g. 500" value={form.packQuantity} onChange={(e) => setForm({ ...form, packQuantity: e.target.value })} />
              </label>
              <label>Pack unit
                <select value={form.packUnit || unitOptions[0]?.value || ''} onChange={(e) => setForm({ ...form, packUnit: e.target.value })}>
                  {unitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>Total pack price (₹)
                <input required type="number" min="0.01" max="1000000" step="any" placeholder="e.g. 120" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </label>
            </div>
            <div className="ks-price-form-actions">
              <button type="submit" className="ks-price-primary"><Plus size={16}/>{editingId ? 'Update offer' : 'Save manual offer'}</button>
              {editingId && <button className="ks-price-quiet" type="button" onClick={resetForm}>Cancel editing</button>}
            </div>
          </form>

          {error && <div className="ks-price-error" role="alert">{error}</div>}
          {notice && <div className="ks-price-notice" role="status"><CheckCircle2 size={17}/>{notice}</div>}

          <div className="ks-price-results-head">
            <h3>Entered offers ({itemOffers.length})</h3>
            <small>Lowest rate first · Manual entries only</small>
          </div>
          {itemOffers.length === 0 ? (
            <div className="ks-price-empty">No prices entered for {item.name} yet. Add two offers above to compare their unit prices.</div>
          ) : (
            <div className="ks-price-offers">
              {itemOffers.map((offer, index) => (
                <article key={offer.id} className={`ks-price-offer ${index === 0 ? 'ks-price-offer-best' : ''}`}>
                  <div className="ks-price-offer-main">
                    <div>
                      <div className="ks-price-offer-store">{offer.store}</div>
                      <span className="ks-price-source">Manual entry · {recordedDate(offer.recordedAt)}</span>
                    </div>
                    {index === 0 && <span className="ks-price-best">Lowest entered rate</span>}
                  </div>
                  <div className="ks-price-offer-values">
                    <div><small>Pack</small><strong>{offer.packQuantity} {offer.packUnit}</strong></div>
                    <div><small>Total</small><strong>{formatRupees(offer.price)}</strong></div>
                    <div><small>Comparable rate</small><strong className="ks-price-rate">{formatNormalizedPrice(offer.comparison)}</strong></div>
                  </div>
                  <div className="ks-price-offer-actions">
                    <button type="button" onClick={() => startEditing(offer)}><Pencil size={14}/> Edit</button>
                    <button type="button" onClick={() => removeOffer(offer)}><Trash2 size={14}/> Remove</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="ks-price-disclaimer"><strong>Price transparency:</strong> These offers are entered by you and saved only in this browser. Prices can be outdated and may exclude delivery fees, discounts, and minimum pack quantities. No live retailer connection or demo prices are used.</p>
        </>
      )}
    </section>
  );
}
