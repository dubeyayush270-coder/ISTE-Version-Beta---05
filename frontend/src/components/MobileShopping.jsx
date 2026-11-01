
import PriceComparison from './PriceComparison.jsx';
import QuickCommerceHandoff from './QuickCommerceHandoff.jsx';

import { useEffect, useMemo, useState } from 'react';

import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  PackagePlus,
  ShoppingBasket,
  ShoppingCart,
  X,
} from 'lucide-react';

import { api } from '../lib/api';

import {
  amountLabel,
  makePurchaseRequest,
  normalizedShoppingRows,
  purchaseDateWarning,
} from '../lib/shoppingUtils';

import './MobileShopping.css';

export default function MobileShopping({
  shopping = [],
  inventory = [],
  weekStart,
  onRefresh,
  onNotify,
}) {
  // KitchenSync's actual meal-based shortages.
  const rows = useMemo(
    () => normalizedShoppingRows(shopping),
    [shopping]
  );

  const [expanded, setExpanded] = useState(null);

  const [quantity, setQuantity] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [dateType, setDateType] = useState('expiry');
  const [dateConfirmed, setDateConfirmed] = useState(false);

  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Reset the purchase form when the selected week changes.
  useEffect(() => {
    setExpanded(null);
    setMessage('');
    setError('');
  }, [weekStart]);

  const dateWarning = purchaseDateWarning(dateValue);

  // QUICK-COMMERCE INTEGRATION
  //
  // Send only real, currently missing ingredients.
  //
  // The handoff receives:
  // [{ name: 'Paneer', quantity: 680, unit: 'g' }]
  //
  // It does not receive full pantry inventory.
  const quickCommerceItems = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            Number.isFinite(Number(row.missing)) &&
            Number(row.missing) > 0
        )
        .map((row) => ({
          name: row.name,
          quantity: Number(row.missing),
          unit: row.unit,
        })),
    [rows]
  );

  function openPurchase(row) {
    setExpanded(
      (current) => current === row.key ? null : row.key
    );

    setQuantity(String(row.missing));
    setDateValue('');
    setDateType('expiry');
    setDateConfirmed(false);
    setError('');
    setMessage('');
  }

  // Keep the existing shopping-list clipboard functionality.
  async function copyList() {
    try {
      const items = rows;

      if (!items.length) {
        setMessage(
          'Nothing to copy.'
        );
        return;
      }

      await navigator.clipboard.writeText(
        items
          .map(
            (row) =>
              `${row.name}: ${amountLabel(
                row.missing,
                row.unit
              )}`
          )
          .join('\n')
      );

      setMessage('Shopping list copied.');
      onNotify?.('Shopping list copied');
    } catch {
      setError(
        'Clipboard access is unavailable. Copy the items manually.'
      );
    }
  }

  // Save an actual purchase to KitchenSync's inventory backend.
  async function savePurchase(event, row) {
    event.preventDefault();

    if (saving) return;

    if (dateWarning && !dateConfirmed) {
      setError(
        'Confirm the unusual printed date before saving the purchase.'
      );
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const request = makePurchaseRequest(
        row,
        inventory,
        quantity,
        dateValue,
        dateType
      );

      await api(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });

      setExpanded(null);

      setMessage(
        `${row.name}: ${amountLabel(
          quantity,
          row.unit
        )} saved to Pantry. Shortages are being refreshed.`
      );

      onNotify?.(`${row.name} added to Pantry`);

      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      setError(
        err?.message ||
        'Could not save the purchase. Please retry.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="ks-shopping"
      aria-label="Smart shopping list"
    >
      {/* Shopping header */}
      <header className="ks-shopping-header">
        <div>
          <span className="ks-shopping-eyebrow">
            YOUR WEEKLY SHOPPING
          </span>

          <h1>
            Smart Shopping{' '}
            <span aria-hidden="true">🛒</span>
          </h1>

          <p>Based on your meal plan and Pantry.</p>
        </div>

        <div className="ks-shopping-icon">
          <ShoppingCart size={25} />
        </div>
      </header>

      {/* Shortage summary */}
      <div className="ks-shopping-stats">
        <div className="ks-shopping-stat">
          <strong>{rows.length}</strong>
          <span>Items to buy</span>
        </div>
      </div>

      {/* Error messages */}
      {error && (
        <div
          className="ks-shopping-feedback ks-shopping-error"
          role="alert"
        >
          <AlertCircle size={18} />

          {error}

          <button
            type="button"
            onClick={() => setError('')}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Success messages */}
      {message && (
        <div
          className="ks-shopping-feedback ks-shopping-success"
          role="status"
        >
          <CheckCircle2 size={18} />

          {message}

          <button
            type="button"
            onClick={() => setMessage('')}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Shopping toolbar */}
      <div className="ks-shopping-toolbar">
        <div>
          <h2>Ingredients to buy</h2>

          <p>
            {weekStart ? `Week starting ${weekStart}` : 'Current meal-plan week'}
            {' · '}Record purchases to update Pantry.
          </p>
        </div>

        <div className="ks-shopping-toolbar-actions">
          <button
            type="button"
            onClick={copyList}
            disabled={!rows.length}
            className="ks-shopping-btn ks-shopping-btn-light"
          >
            <ClipboardCopy size={16} />
            Copy list
          </button>

        </div>
      </div>

      {/* Main shopping list */}
      {!rows.length ? (
        <div className="ks-shopping-empty">
          <CheckCircle2 size={36} />

          <h3>You're stocked for the week!</h3>

          <p>
            No missing ingredients were reported for
            the selected meal-plan week. Change your
            plan or refresh to see new needs.
          </p>
        </div>
      ) : (
        <div className="ks-shopping-list">
          {rows.map((row) => (
            <article
              key={row.key}
              className="ks-shopping-item"
            >
              {/* Ingredient name and missing quantity */}
              <div className="ks-shopping-item-main">
                <span className="ks-shopping-name">{row.name}</span>

                <div className="ks-shopping-quantity">
                  <strong>
                    {amountLabel(
                      row.missing,
                      row.unit
                    )}
                  </strong>

                  <small>to buy</small>
                </div>
              </div>

              {/* Required quantity and available stock */}
              <div className="ks-shopping-subline">
                <span>
                  Meal plan:{' '}
                  {amountLabel(
                    row.required,
                    row.unit
                  )}
                </span>

                <span>
                  Usable stock:{' '}
                  {amountLabel(
                    row.available,
                    row.unit
                  )}
                </span>
              </div>

              {/* Shopping actions */}
              <div className="ks-shopping-item-actions">
                <button
                  type="button"
                  className="ks-shopping-btn ks-shopping-btn-primary"
                  style={{ flex: 1 }}
                  onClick={() =>
                    openPurchase(row)
                  }
                  disabled={
                    saving &&
                    expanded !== row.key
                  }
                  aria-expanded={
                    expanded === row.key
                  }
                >
                  <PackagePlus size={16} />

                  {expanded === row.key
                    ? 'Close'
                    : 'Record purchase'}
                </button>
              </div>

              {/* Add purchased ingredient to Pantry */}
              {expanded === row.key && (
                <form
                  className="ks-shopping-purchase"
                  onSubmit={(event) =>
                    savePurchase(event, row)
                  }
                  aria-busy={saving}
                >
                  <div className="ks-shopping-help">
                    Confirm quantity to add to Pantry.
                  </div>

                  <div className="ks-shopping-form-grid">
                    <label>
                      Purchased quantity ({row.unit})

                      <input
                        autoFocus
                        required
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="any"
                        value={quantity}
                        onChange={(event) =>
                          setQuantity(
                            event.target.value
                          )
                        }
                      />
                    </label>

                    <label>
                      Printed date (optional)

                      <input
                        type="date"
                        value={dateValue}
                        onChange={(event) => {
                          setDateValue(
                            event.target.value
                          );
                          setDateConfirmed(false);
                        }}
                      />
                    </label>

                    {dateValue && (
                      <label>
                        Date type

                        <select
                          value={dateType}
                          onChange={(event) =>
                            setDateType(
                              event.target.value
                            )
                          }
                        >
                          <option value="expiry">
                            Expiry date
                          </option>

                          <option value="use_by">
                            Use-by date
                          </option>

                          <option value="best_before">
                            Best-before date
                          </option>
                        </select>
                      </label>
                    )}
                  </div>

                  {/* Date validation */}
                  {dateWarning && (
                    <div
                      className="ks-shopping-date-warning"
                      role="alert"
                    >
                      <AlertCircle
                        size={18}
                        aria-hidden="true"
                      />

                      <div>
                        <p>{dateWarning}</p>

                        <label className="ks-shopping-date-confirm">
                          <input
                            type="checkbox"
                            checked={dateConfirmed}
                            onChange={(event) =>
                              setDateConfirmed(
                                event.target.checked
                              )
                            }
                          />

                          I checked the printed date
                          and want to save it as entered.
                        </label>
                      </div>
                    </div>
                  )}

                  <p className="ks-shopping-helper-text">
                    No date? Leave blank.
                  </p>

                  <button
                    type="submit"
                    disabled={
                      saving ||
                      Boolean(
                        dateWarning &&
                        !dateConfirmed
                      )
                    }
                    className="ks-shopping-btn ks-shopping-btn-primary ks-shopping-submit"
                  >
                    <PackagePlus size={16} />

                    {saving
                      ? 'Saving purchase...'
                      : 'Save to Pantry'}
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      <footer className="ks-shopping-footer">
        <ShoppingBasket size={18} />
        <p>Record purchases to update Pantry stock.</p>
      </footer>

      <details className="ks-shopping-extra">
        <summary>Open quick-commerce stores <span>External shopping links</span></summary>
        <QuickCommerceHandoff items={quickCommerceItems} />
      </details>
      <details className="ks-shopping-extra">
        <summary>Compare online prices <span>Blinkit · Zepto · Instamart</span></summary>
        <PriceComparison rows={rows} />
      </details>
    </section>
  );
}
