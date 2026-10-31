
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  History,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { api } from "../lib/api";

const numberLabel = (value, unit) =>
  `${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })} ${unit}`;

function historyDate(value) {
  if (!value) return "Date unavailable";

  // SQLite CURRENT_TIMESTAMP stores UTC.
  const iso = String(value).replace(" ", "T") + "Z";
  const parsed = new Date(iso);

  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

async function loadRecordedQuantity(itemId) {
  const batchData = await api(`/inventory/${itemId}/batches`);

  if (batchData.batches?.length) {
    return Number(batchData.total_quantity);
  }

  // Legacy items have no batches; fetch the current summary as well.
  const inventory = await api("/inventory");
  const current = inventory.find(item => item.id === itemId);

  if (!current) {
    throw new Error("This ingredient is no longer in the pantry.");
  }

  return Number(current.quantity);
}

export default function AuditStock({
  ingredient,
  onClose,
  onSaved,
}) {
  const [recorded, setRecorded] = useState(
    Number(ingredient.quantity || 0)
  );
  const [actual, setActual] = useState(
    String(ingredient.quantity ?? 0)
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const base = `/inventory/${ingredient.id}`;

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setReady(false);
      setError("");

      try {
        const [total, historyData] = await Promise.all([
          loadRecordedQuantity(ingredient.id),
          api(`${base}/reconciliations`),
        ]);

        if (!active) return;

        setRecorded(total);
        setActual(String(total));
        setHistory(historyData.adjustments || []);
        setReady(true);
      } catch (err) {
        if (active) {
          setError(
            err.message || "Could not load stock audit data."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [base, ingredient.id]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () =>
      window.removeEventListener("keydown", handleEscape);
  }, [onClose, saving]);

  const quantity = Number(actual);

  const validQuantity =
    actual.trim() !== "" &&
    Number.isFinite(quantity) &&
    quantity >= 0 &&
    quantity <= 1000000 &&
    Math.abs(quantity - Number(quantity.toFixed(2))) < 1e-9 &&
    (ingredient.unit !== "pcs" || Number.isInteger(quantity));

  const difference = validQuantity
    ? Number((quantity - recorded).toFixed(2))
    : null;

  const canSave =
    ready &&
    !loading &&
    !saving &&
    validQuantity &&
    difference !== 0 &&
    reason.trim().length >= 3 &&
    reason.trim().length <= 250 &&
    confirmed;

  async function saveAudit(event) {
    event.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      // Recheck the total before submitting. Another user
      // may have added or modified a purchase batch.
      const latest = await loadRecordedQuantity(ingredient.id);

      if (Math.abs(latest - recorded) > 0.001) {
        setRecorded(latest);
        setConfirmed(false);
        setError(
          "Pantry stock changed since this audit was opened. " +
          "Review the new recorded total before confirming."
        );
        return;
      }

      const result = await api(`${base}/reconcile`, {
        method: "POST",
        body: JSON.stringify({
          actual_quantity: Number(quantity.toFixed(2)),
          reason: reason.trim(),
          confirmed: true,
        }),
      });

      const updatedTotal = Number(
        result.actual_quantity ?? quantity
      );

      setRecorded(updatedTotal);
      setActual(String(updatedTotal));
      setConfirmed(false);
      setReason("");
      setSaved(true);

      setNotice("Physical stock count saved successfully.");

      // Refresh the parent inventory before leaving the modal.
      try {
        await onSaved?.();
      } catch {
        setNotice(
          "Stock saved, but the Pantry screen could not refresh. " +
          "Reload the page to see the latest totals."
        );
      }

      try {
        const resultHistory = await api(
          `${base}/reconciliations`
        );
        setHistory(resultHistory.adjustments || []);
      } catch {
        setNotice(
          "Stock saved. Adjustment history could not be refreshed."
        );
      }
    } catch (err) {
      setError(
        err.message || "Could not save stock reconciliation."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-stock-title"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-[#f8faf7] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#e4eee4] bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#57936e]">
              Pantry Stock Verification
            </p>

            <h2
              id="audit-stock-title"
              className="mt-1 flex items-center gap-2 text-xl font-extrabold text-[#27523b]"
            >
              <ClipboardCheck size={22} />
              Audit Stock
            </h2>

            <p className="mt-1 text-sm text-[#6d8776]">
              {ingredient.name}
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close stock audit"
            className="rounded-xl bg-[#edf5ee] p-2 text-[#315c41] disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-sm text-[#57715e]">
              <RefreshCw
                size={20}
                className="animate-spin"
              />
              Loading stock audit...
            </div>
          ) : (
            <>
              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              {notice && (
                <div
                  role="status"
                  className="mb-4 flex gap-2 rounded-xl bg-[#e5f4e9] p-3 text-sm text-[#246342]"
                >
                  <CheckCircle2
                    size={18}
                    className="shrink-0"
                  />
                  {notice}
                </div>
              )}

              <div className="mb-4 rounded-2xl bg-[#e4f3e8] p-4">
                <p className="text-xs font-bold text-[#688874]">
                  Recorded physical stock
                </p>

                <p className="mt-1 text-3xl font-extrabold text-[#246344]">
                  {numberLabel(recorded, ingredient.unit)}
                </p>

                <p className="mt-2 text-xs leading-relaxed text-[#66816e]">
                  This is total physical stock, including any
                  expired batches. Usable stock may be lower.
                </p>
              </div>

              <form onSubmit={saveAudit}>
                <label
                  htmlFor="audit-actual-quantity"
                  className="mb-1 block text-sm font-bold text-[#365a43]"
                >
                  Quantity physically counted ({ingredient.unit})
                </label>

                <input
                  id="audit-actual-quantity"
                  type="number"
                  min="0"
                  max="1000000"
                  step={ingredient.unit === "pcs" ? "1" : "0.01"}
                  required
                  disabled={saving || !ready}
                  value={actual}
                  onChange={event => {
                    setActual(event.target.value);
                    setConfirmed(false);
                    setSaved(false);
                  }}
                  className="mb-4 w-full rounded-xl border border-[#d4e5d7] bg-white px-4 py-3 text-base text-[#244d35] outline-none focus:border-[#48966b]"
                />

                {!validQuantity && (
                  <p
                    role="alert"
                    className="mb-3 text-xs text-red-700"
                  >
                    Enter a valid non-negative quantity.
                    Pieces must be whole numbers.
                  </p>
                )}

                {difference !== null && (
                  <div className="mb-4 rounded-2xl border border-[#deebdf] bg-white p-4">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#6a8471]">
                      Stock discrepancy
                    </p>

                    <p
                      className={`text-2xl font-extrabold ${
                        difference < 0
                          ? "text-red-700"
                          : difference > 0
                            ? "text-[#25784e]"
                            : "text-[#426750]"
                      }`}
                    >
                      {difference > 0 ? "+" : ""}
                      {numberLabel(
                        difference,
                        ingredient.unit
                      )}
                    </p>

                    <p className="mt-2 text-xs leading-relaxed text-[#6e8373]">
                      {difference < 0
                        ? "Less stock was found than recorded. The backend will reduce purchase batches starting with the earliest expiry."
                        : difference > 0
                          ? "More stock was found than recorded. The extra amount will be saved separately with an unknown expiry date."
                          : "Your physical count matches the recorded quantity."}
                    </p>
                  </div>
                )}

                <label
                  htmlFor="audit-reason-preset"
                  className="mb-1 block text-sm font-bold text-[#365a43]"
                >
                  Reason for correction
                </label>

                <select
                  id="audit-reason-preset"
                  disabled={saving || !ready}
                  className="mb-3 w-full rounded-xl border border-[#d4e5d7] bg-white px-3 py-3 text-sm text-[#345d41]"
                  value={reason}
                  onChange={event => {
                    setReason(event.target.value);
                    setConfirmed(false);
                  }}
                  aria-label="Select correction reason"
                >
                  <option value="">Select reason</option>
                  <option value="Used but not recorded">
                    Used but not recorded
                  </option>
                  <option value="Spillage or wastage">
                    Spillage or wastage
                  </option>
                  <option value="Additional stock found">
                    Additional stock found
                  </option>
                  <option value="Incorrect previous count">
                    Incorrect previous count
                  </option>
                  <option value="Physical inventory recount">
                    Physical inventory recount
                  </option>
                </select>

                <label
                  htmlFor="audit-reason"
                  className="sr-only"
                >
                  Adjustment reason
                </label>

                <textarea
                  id="audit-reason"
                  disabled={saving || !ready}
                  value={reason}
                  maxLength={250}
                  onChange={event => {
                    setReason(event.target.value);
                    setConfirmed(false);
                  }}
                  placeholder="Explain the stock difference..."
                  rows={2}
                  className="mb-4 w-full resize-y rounded-xl border border-[#d4e5d7] bg-white px-3 py-3 text-sm text-[#345d41]"
                />

                <label className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    disabled={saving || !ready}
                    checked={confirmed}
                    onChange={event =>
                      setConfirmed(event.target.checked)
                    }
                    className="mt-1"
                  />
                  <span>
                    I have physically checked the quantity,
                    reviewed the discrepancy, and confirm
                    this inventory adjustment.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={!canSave}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#247a51] px-4 py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Save size={17} />

                  {saving
                    ? "Saving adjustment..."
                    : "Confirm & Update Stock"}
                </button>

                {saved && (
                  <p className="mt-3 text-center text-xs font-semibold text-[#247a51]">
                    Audit saved. You can close this window.
                  </p>
                )}
              </form>

              <div className="mt-7 border-t border-[#e1e9e1] pt-5">
                <h3 className="mb-3 flex items-center gap-2 text-base font-extrabold text-[#325a3e]">
                  <History size={18} />
                  Adjustment History
                </h3>

                {history.length === 0 ? (
                  <p className="rounded-xl bg-white p-4 text-sm text-[#829286]">
                    No previous stock corrections recorded.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map(entry => (
                      <article
                        key={entry.id}
                        className="rounded-xl border border-[#e2ebe2] bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-[#31543d]">
                              {entry.reason}
                            </p>

                            <p className="mt-1 text-xs text-[#829286]">
                              {historyDate(entry.created_at)}
                            </p>
                          </div>

                          <strong
                            className={`text-sm ${
                              entry.difference < 0
                                ? "text-red-700"
                                : "text-[#27784d]"
                            }`}
                          >
                            {entry.difference > 0 ? "+" : ""}
                            {numberLabel(
                              entry.difference,
                              entry.unit
                            )}
                          </strong>
                        </div>

                        <p className="mt-2 text-xs text-[#617b68]">
                          {numberLabel(
                            entry.previous_quantity,
                            entry.unit
                          )}
                          {" → "}
                          {numberLabel(
                            entry.actual_quantity,
                            entry.unit
                          )}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex gap-2 rounded-xl bg-[#fff7e8] p-3 text-xs leading-relaxed text-[#886a34]">
                <AlertTriangle
                  size={17}
                  className="shrink-0"
                />
                Physical counting does not confirm food
                safety or freshness. Review unknown-expiry
                and expired batches separately.
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
