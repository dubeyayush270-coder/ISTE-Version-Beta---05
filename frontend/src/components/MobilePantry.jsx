
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Package,
  PackageCheck,
  Search,
  AlertTriangle,
  CalendarClock,
  ArrowRight,
  X,
  Camera,
  Plus,
  Pencil,
  Trash2,
  Save,
  ClipboardCheck,
} from "lucide-react";

import ExpiryScanner from "./ExpiryScanner.jsx";
import AuditStock from "./AuditStock.jsx";
import { createWorker } from "tesseract.js";
import { api } from "../lib/api";
import { buildPantrySavePlan, dateWarnings, validateScanItem, extractPackageDateDetails, quantityFromPackageText, summarizeBulkReview } from "../lib/scannerUtils.js";
import "./MobilePantry.css";

const FILTERS = [
  { id: "all", label: "All Items" },
  { id: "low", label: "Low Stock" },
  { id: "expiring", label: "Expiring" },
];

const DEFAULT_LOW_STOCK_THRESHOLDS = {
  g: 100,
  ml: 100,
  pcs: 2,
};

const DATE_TYPES = [
  { value: "unknown", label: "Not specified" },
  { value: "expiry", label: "Expiry date" },
  { value: "use_by", label: "Use-by date" },
  { value: "best_before", label: "Best-before date" },
  { value: "estimated", label: "Estimated freshness" },
];

const EMPTY_BATCH = {
  quantity: "",
  expiry_date: "",
  date_type: "unknown",
  date_source: "manual",
  barcode: "",
  purchase_date: "",
  storage: "",
};

function daysUntil(value) {
  if (!value) return null;

  const expiry = new Date(
    `${String(value).slice(0, 10)}T00:00:00`
  );

  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round(
    (expiry.getTime() - today.getTime()) / 86400000
  );
}

function ingredientIcon(name = "") {
  const value = name.toLowerCase();

  if (value.includes("rice")) return "🍚";
  if (value.includes("tomato")) return "🍅";
  if (value.includes("onion")) return "🧅";
  if (value.includes("potato")) return "🥔";
  if (value.includes("paneer")) return "🧀";
  if (value.includes("milk")) return "🥛";
  if (value.includes("egg")) return "🥚";
  if (value.includes("chilli")) return "🌶️";
  if (value.includes("carrot")) return "🥕";
  if (value.includes("oil")) return "🫒";
  if (value.includes("flour")) return "🌾";
  if (value.includes("apple")) return "🍎";

  return "🥣";
}

function normalizeItem(item, index) {
  const quantity = Number(item.quantity ?? item.qty ?? 0);

  const available = Number(
    item.usable_quantity ??
    (item.usable === false ? 0 : quantity)
  );

const thresholdValue =
  item.min_quantity ??
  item.minimum_quantity ??
  item.low_stock_threshold ??
  item.reorder_level ??
  DEFAULT_LOW_STOCK_THRESHOLDS[item.unit] ??
  null;

  const threshold =
    thresholdValue == null || thresholdValue === ""
      ? null
      : Number(thresholdValue);

  const expiry =
    item.expiry_date ??
    item.expires_on ??
    item.expiration_date ??
    item.expiry ??
    null;

  const remainingDays = daysUntil(expiry);

  const outOfStock = available <= 0;

  const lowStock =
    outOfStock ||
    (
      threshold !== null &&
      Number.isFinite(threshold) &&
      available <= threshold
    );

  const expired =
    quantity > 0 &&
    available <= 0 &&
    remainingDays !== null &&
    remainingDays < 0;

  const expiring =
    remainingDays !== null &&
    remainingDays >= 0 &&
    remainingDays <= 3;

  return {
    ...item,
    _key: item.id ?? `${item.name}-${index}`,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    usable_quantity: Number.isFinite(available)
      ? available
      : 0,
    unit: item.unit || "",
    remainingDays,
    outOfStock,
    lowStock,
    expired,
    expiring,
  };
}

function Status({ item }) {
  if (item.expired) {
    return (
      <span className="kspantry-status danger">
        Review expiry
      </span>
    );
  }

  if (item.outOfStock) {
    return (
      <span className="kspantry-status danger">
        No usable stock
      </span>
    );
  }

  if (item.expiring) {
    return (
      <span className="kspantry-status warning">
        Expiring soon
      </span>
    );
  }

  if (item.lowStock) {
    return (
      <span className="kspantry-status warning">
        Low stock
      </span>
    );
  }

  return (
    <span className="kspantry-status good">
      In stock
    </span>
  );
}


function batchDraft(batch = {}) {
  const source = batch ?? {};

  return {
    ...EMPTY_BATCH,
    quantity: source.quantity ?? "",
    expiry_date: source.expiry_date || "",
    date_type: source.date_type || "unknown",
    date_source: source.date_source || "manual",
    barcode: source.barcode || "",
    purchase_date: source.purchase_date || "",
    storage: source.storage || "",
  };
}


function batchDateLabel(batch) {
  if (!batch.expiry_date) {
    return "No date recorded";
  }

  const days = daysUntil(batch.expiry_date);

  if (days === null) {
    return "Check recorded date";
  }

  if (days < 0) {
    return "Recorded date has passed";
  }

  if (days === 0) {
    return "Recorded date is today";
  }

  if (days <= 3) {
    return `Recorded date in ${days} days`;
  }

  return `Date: ${batch.expiry_date}`;
}

function PurchaseBatchManager({
  ingredient,
  scanned,
  onClose,
  onChanged,
}) {
  const [batches, setBatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateVerified, setDateVerified] = useState(false);
  const savingLock = useRef(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(Boolean(scanned));
  const [draft, setDraft] = useState(() => batchDraft(scanned));

  const base = `/inventory/${ingredient.id}/batches`;

  const loadBatches = useCallback(async () => {
    const result = await api(
      `/inventory/${ingredient.id}/batches`
    );

    setBatches(result.batches || []);
    setTotal(Number(result.total_quantity || 0));
  }, [ingredient.id]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);

      try {
        const result = await api(
          `/inventory/${ingredient.id}/batches`
        );

        if (!active) return;

        setBatches(result.batches || []);
        setTotal(Number(result.total_quantity || 0));
      } catch (err) {
        if (active) {
          setError(
            err.message || "Could not load purchase batches."
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
  }, [ingredient.id]);

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, saving]);

  const change = (field, value) => {
    setDraft(current => ({
      ...current,
      [field]: value,
    }));
  };

  const startAdd = () => {
    setEditingId(null);
    setDraft(batchDraft());
    setDateVerified(false);
    setError("");
    setFormOpen(true);
  };

  const startEdit = batch => {
    setEditingId(batch.id);
    setDraft(batchDraft(batch));
    setDateVerified(false);
    setError("");
    setFormOpen(true);
  };

  const cancelForm = () => {
    setEditingId(null);
    setDraft(batchDraft());
    setDateVerified(false);
    setError("");
    setFormOpen(false);
  };

  const saveBatch = async event => {
    event.preventDefault();
    if (savingLock.current) return;

    const quantity = Number(draft.quantity);
    if (dateWarnings(draft.expiry_date).length && !dateVerified) {
      setError("Please check the suspicious printed date and confirm it before saving.");
      return;
    }

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000
    ) {
      setError("Enter a valid quantity greater than zero.");
      return;
    }

    const payload = {
      quantity,
      expiry_date: draft.expiry_date || null,
      date_type: draft.date_type,
      date_source: draft.date_source || "manual",
      barcode: draft.barcode.trim() || null,
      purchase_date: draft.purchase_date || null,
      storage: draft.storage || null,
    };

    savingLock.current = true;
    setSaving(true);
    setError("");

    try {
      await api(
        editingId ? `${base}/${editingId}` : base,
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify(payload),
        }
      );

      // After server confirms the save, do not ask users to retry if UI refresh fails.
      try { await loadBatches(); } catch { setError("Saved. Batch list may need refreshing."); }
      await onChanged();

      setFormOpen(false);
      setEditingId(null);
      setDraft(batchDraft());
    } catch (err) {
      setError(
        err.message || "Failed to save purchase batch."
      );
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  const removeBatch = async batch => {
    const confirmed = window.confirm(
      `Delete batch #${batch.id} of ${ingredient.name}?`
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");

    try {
      await api(`${base}/${batch.id}`, {
        method: "DELETE",
      });

      await loadBatches();
      await onChanged();
    } catch (err) {
      setError(
        err.message || "Failed to delete purchase batch."
      );
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-[#dce9dc] " +
    "bg-white px-3 py-3 text-sm text-[#254632] " +
    "outline-none focus:border-[#48966b]";

  const labelClass =
    "mb-1 block text-xs font-bold text-[#5b7964]";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Purchase batches for ${ingredient.name}`}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-[#f8faf7] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#e4eee4] bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#57936e]">
              Pantry Purchases
            </p>
            <h2 className="mt-1 text-xl font-extrabold text-[#27523b]">
              {ingredientIcon(ingredient.name)} {ingredient.name}
            </h2>
            <p className="mt-1 text-xs text-[#819588]">
              Manage individual purchase batches
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close purchase batches"
            className="rounded-xl bg-[#edf5ee] p-2 text-[#315c41]"
          >
            <X size={20} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 rounded-2xl bg-[#e2f2e6] p-4">
            <p className="text-xs text-[#65856e]">
              Total recorded stock
            </p>
            <strong className="text-2xl text-[#286849]">
              {total} {ingredient.unit}
            </strong>
            <p className="mt-1 text-xs text-[#748d7a]">
              {batches.length} purchase batches
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="py-8 text-center text-sm text-[#819487]">
              Loading purchases...
            </p>
          ) : (
            <div className="space-y-3">
              {batches.map(batch => (
                <article
                  key={batch.id}
                  className="rounded-2xl border border-[#e3ece2] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="text-sm text-[#30533e]">
                        Batch #{batch.id}
                      </strong>

                      <p className="mt-1 text-lg font-bold text-[#29533c]">
                        {batch.quantity} {ingredient.unit}
                      </p>

                      <p className="mt-1 text-xs text-[#718a79]">
                        {batchDateLabel(batch)}
                      </p>

                      <p className="mt-1 text-xs text-[#819587]">
                        {DATE_TYPES.find(
                          option =>
                            option.value === batch.date_type
                        )?.label || batch.date_type}
                      </p>

                      {batch.barcode && (
                        <p className="mt-1 break-all text-xs text-[#819587]">
                          Barcode: {batch.barcode}
                        </p>
                      )}

                      {batch.storage && (
                        <p className="mt-1 text-xs capitalize text-[#819587]">
                          Storage: {batch.storage.replaceAll("_", " ")}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => startEdit(batch)}
                        aria-label={`Edit batch ${batch.id}`}
                        className="rounded-xl bg-[#eaf5ed] p-2 text-[#2f7850]"
                      >
                        <Pencil size={17} />
                      </button>

                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => removeBatch(batch)}
                        aria-label={`Delete batch ${batch.id}`}
                        className="rounded-xl bg-red-50 p-2 text-red-600"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              {batches.length === 0 && (
                <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#819487]">
                  No purchases recorded.
                </div>
              )}
            </div>
          )}

          {!formOpen ? (
            <button
              type="button"
              disabled={saving}
              onClick={startAdd}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#247a51] px-4 py-3 font-bold text-white"
            >
              <Plus size={18} />
              Add Purchase Batch
            </button>
          ) : (
            <form
              onSubmit={saveBatch}
              className="mt-5 space-y-4 rounded-2xl border border-[#dce9dc] bg-white p-4"
            >
              <h3 className="font-extrabold text-[#2c6545]">
                {editingId ? "Edit Purchase" : "New Purchase"}
              </h3>

              <div>
                <label className={labelClass}>
                  Quantity ({ingredient.unit})
                </label>
                <input
                  className={inputClass}
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="1000000"
                  required
                  value={draft.quantity}
                  onChange={e =>
                    change("quantity", e.target.value)
                  }
                  placeholder="Enter quantity"
                />
              </div>

              <div>
                <label className={labelClass}>
                  Printed date (optional)
                </label>
                <input
                  className={inputClass}
                  type="date"
                  value={draft.expiry_date}
                  onChange={e => {
                    change("expiry_date", e.target.value);
                    setDateVerified(false);
                  }}
                />
                {dateWarnings(draft.expiry_date).length > 0 && (
                  <label className="mt-2 flex items-start gap-2 rounded-xl bg-[#fff3df] p-3 text-xs">
                    <input type="checkbox" checked={dateVerified} onChange={e => setDateVerified(e.target.checked)} />
                    {dateWarnings(draft.expiry_date).join(' ')} I checked this date against the package.
                  </label>
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Date type
                </label>
                <select
                  className={inputClass}
                  value={draft.date_type}
                  onChange={e =>
                    change("date_type", e.target.value)
                  }
                >
                  {DATE_TYPES.map(option => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>
                  Barcode (optional)
                </label>
                <input
                  className={inputClass}
                  type="text"
                  value={draft.barcode}
                  onChange={e =>
                    change("barcode", e.target.value)
                  }
                  placeholder="Scanned or entered barcode"
                />
              </div>

              <div>
                <label className={labelClass}>
                  Purchase date (optional)
                </label>
                <input
                  className={inputClass}
                  type="date"
                  value={draft.purchase_date}
                  onChange={e =>
                    change("purchase_date", e.target.value)
                  }
                />
              </div>

              <div>
                <label className={labelClass}>
                  Storage method
                </label>
                <select
                  className={inputClass}
                  value={draft.storage}
                  onChange={e =>
                    change("storage", e.target.value)
                  }
                >
                  <option value="">Not specified</option>
                  <option value="refrigerated">Refrigerated</option>
                  <option value="room_temperature">
                    Room temperature
                  </option>
                  <option value="frozen">Frozen</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelForm}
                  className="flex-1 rounded-xl border border-[#dce7dc] px-3 py-3 text-sm font-bold text-[#587562]"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#247a51] px-3 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? "Saving..." : "Save Batch"}
                </button>
              </div>
            </form>
          )}

          <p className="mt-4 text-xs leading-relaxed text-[#829286]">
            Each purchase retains its own recorded date.
            Best-before and estimated freshness dates are not
            guarantees of food safety.
          </p>
        </div>
      </section>
    </div>
  );
}


// Bulk receipt review: one list for the whole shopping trip. Users approve the
// proposed inventory changes once, but every API write uses the established
// inventory or purchase-batch endpoint. Incomplete rows remain unsaved.
function ReceiptPantryReview({ items, inventory, onClose, onChanged }) {
  const [rows, setRows] = useState(() => items.map((item, i) => ({
    ...item, _reviewId: i, selected: item.selected !== false, status: 'pending',
    expiry_date: item.expiry_date || '', date_type: item.date_type || 'unknown',
    manufactured_date: item.manufactured_date || '',
    labelCandidates: item.labelCandidates || [], labelText: item.labelText || '',
    confirmedSuspicious: false,
  })));
  const [expanded, setExpanded] = useState(() => Object.fromEntries(items.map((item, i) => [i, !validateScanItem(item).valid])));
  const [saving, setSaving] = useState(false);
  const [labelBusy, setLabelBusy] = useState(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const savingLock = useRef(false);
  const ocrWorkerRef = useRef(null);
  const uploadLock = useRef(false);
  const [cameraRowId, setCameraRowId] = useState(null);
  const [cameraFacing, setCameraFacing] = useState('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const labelVideoRef = useRef(null);
  const labelStreamRef = useRef(null);
  const stopLabelStream = () => {
    labelStreamRef.current?.getTracks().forEach(track => track.stop());
    labelStreamRef.current = null;
    if (labelVideoRef.current?.srcObject) labelVideoRef.current.srcObject = null;
  };

  useEffect(() => {
    if (cameraRowId === null) return undefined;
    let cancelled = false;
    setCameraReady(false);
    setCameraError('');
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires a supported browser on HTTPS or localhost. Use Upload Label instead.');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false, video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        labelStreamRef.current = stream;
        if (!labelVideoRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
        labelVideoRef.current.srcObject = stream;
        await labelVideoRef.current.play();
        if (!cancelled) setCameraReady(true);
      } catch (err) {
        if (!cancelled) setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow access in Chrome or upload the label photo.'
          : `Camera unavailable: ${err.message || 'unknown error'}. You can upload a photo instead.`);
      }
    }
    void start();
    return () => { cancelled = true; stopLabelStream(); };
  }, [cameraRowId, cameraFacing]);

  useEffect(() => () => { ocrWorkerRef.current?.terminate().catch(() => {}); stopLabelStream(); }, []);

  const summary = summarizeBulkReview(rows);
  const readyRows = rows.filter(row => summary.readyIds.includes(row._reviewId));
  const hasUnknownDates = readyRows.some(row => !row.expiry_date);
  const inputStyle = 'mt-1 min-h-11 w-full rounded-xl border border-[#dce9dc] bg-white p-3 text-sm focus:ring-2 focus:ring-[#287b50]';
  const updateRow = (id, key, value) => {
    setRows(previous => previous.map(row => row._reviewId === id
      ? { ...row, [key]: value, ...(key === 'expiry_date' || key === 'date_type' ? { confirmedSuspicious: false } : {}) }
      : row));
    setError('');
  };
  const toggleExpanded = id => setExpanded(value => ({ ...value, [id]: !value[id] }));

  async function scanLabelFile(image, id) {
    if (!image || uploadLock.current || savingLock.current) return;
    uploadLock.current = true;
    setLabelBusy(id); setError('');
    try {
      if (!image.type.startsWith('image/')) throw new Error('Choose a package label photograph.');
      if (!ocrWorkerRef.current) ocrWorkerRef.current = await createWorker('eng');
      const result = await ocrWorkerRef.current.recognize(image);
      const text = result.data.text || '';
      const dates = extractPackageDateDetails(text);
      const pack = quantityFromPackageText(text);
      setRows(previous => previous.map(row => {
        if (row._reviewId !== id || row.status !== 'pending') return row;
        const changes = {
          labelCandidates: dates.expiry,
          labelText: text.slice(0, 2000),
          confirmedSuspicious: false
        };
        if (dates.manufactured.length === 1) changes.manufactured_date = dates.manufactured[0].date;
        // Auto-fill a uniquely labelled expiry/use-by/best-before date.
        // Manufacturing dates and unlabelled dates are never promoted to expiry.
        if (!row.expiry_date && dates.expiry.length === 1) {
          changes.expiry_date = dates.expiry[0].date;
          changes.date_type = dates.expiry[0].type;
        }
        // A label may state one pack size, not the full shopping-trip quantity.
        // Never override the receipt's confirmed total.
        if (pack && !row.quantity && !row.unit) {
          changes.quantity = pack.quantity;
          changes.unit = pack.unit;
        }
        return { ...row, ...changes };
      }));
      setExpanded(value => ({ ...value, [id]: true }));
      if (!dates.expiry.length) {
        setError(`No clearly labelled expiry/use-by/best-before date found for item ${id + 1}. MFG alone is not expiry. Retake the label with sharper focus, or leave expiry unknown.`);
      } else if (dates.expiry.length > 1) {
        setError(`Several printed date candidates found for item ${id + 1}. Choose the correct one from its expanded review.`);
      }
    } catch (err) {
      setError(`Could not read the label for item ${id + 1}: ${err.message || 'OCR failed'}. Retake or upload a sharper photo.`);
    } finally {
      uploadLock.current = false;
      setLabelBusy(null);
    }
  }

  function scanLabelForRow(event, id) {
    const input = event.currentTarget;
    const image = input.files?.[0];
    input.value = '';
    if (image) void scanLabelFile(image, id);
  }

  async function captureDatePhoto() {
    const id = cameraRowId;
    const video = labelVideoRef.current;
    if (id === null || !video || !cameraReady || !video.videoWidth) {
      setCameraError('Camera image is not ready. Try again or upload a label photograph.'); return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { setCameraError('Capture failed. Upload a photograph instead.'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    setCameraRowId(null); stopLabelStream(); setCameraReady(false);
    if (image) await scanLabelFile(image, id);
    else setError('Could not capture the photograph. Try again or upload an image.');
  }

  const saveReady = async () => {
    if (savingLock.current || !readyRows.length) return;
    savingLock.current = true;
    setSaving(true); setError('');
    let completed = 0;
    try {
      for (const row of readyRows) {
        setProgress(`Saving ${completed + 1} of ${readyRows.length} confirmed items...`);
        // Other scans and teammates can change Pantry while this review is open.
        // Resolve the ingredient again immediately before each POST.
        const latest = await api('/inventory');
        const plan = buildPantrySavePlan(latest, row);
        try {
          await api(plan.path, { method: 'POST', body: JSON.stringify(plan.payload) });
        } catch (err) {
          // A network failure may occur AFTER a server write. Do not allow an
          // automatic retry that could double-add a batch.
          setRows(previous => previous.map(item => item._reviewId === row._reviewId ? { ...item, status: 'uncertain' } : item));
          throw new Error(`Could not confirm the save of "${row.name}". Check Pantry before attempting to save it again. ${err.message || ''}`);
        }
        completed += 1;
        setRows(previous => previous.map(item => item._reviewId === row._reviewId ? { ...item, status: 'saved' } : item));
      }
      setProgress(`${completed} item(s) saved. ${rows.length - completed - summary.saved} other row(s) may still need review.`);
    } catch (err) {
      setError(err.message || 'The save was interrupted. Check which items were saved.');
    } finally {
      if (completed > 0) {
        try { await onChanged?.(); }
        catch { setError(old => `${old} Pantry refresh failed; reload the page to verify the saved items.`.trim()); }
      }
      savingLock.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[850] flex items-center justify-center bg-[#102719]/60 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label="Bulk grocery receipt review">
      <div className="max-h-[96dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-[#edf3ee] p-3 text-[#254b37] shadow-xl sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">Weekly groceries · Bulk review</h2>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Close bulk review" className="min-h-11 min-w-11 rounded-xl bg-white"><X className="mx-auto" size={20} /></button>
        </div>
        <p className="mb-3 text-xs text-[#647a68]">All receipt and barcode items appear here together. Each has its own Take date photo / Upload label action. OCR prefills dates when explicitly labelled. Verify the dates, then save all ready items once. Bill date is never expiry.</p>
        <div className="mb-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-white p-2"><strong className="block text-lg">{summary.ready}</strong><span className="text-[11px]">Ready</span></div>
          <div className="rounded-xl bg-white p-2"><strong className="block text-lg">{summary.incomplete}</strong><span className="text-[11px]">Need details</span></div>
          <div className="rounded-xl bg-white p-2"><strong className="block text-lg">{summary.saved}</strong><span className="text-[11px]">Saved</span></div>
        </div>
        <div className="space-y-2">
          {rows.map((row, i) => {
            const checked = validateScanItem(row);
            const warnings = dateWarnings(row.expiry_date);
            const dateTypeMissing = Boolean(row.expiry_date && !['expiry', 'use_by', 'best_before'].includes(row.date_type));
            const isReady = summary.readyIds.includes(row._reviewId);
            const isOpen = Boolean(expanded[row._reviewId]);
            return <section key={row._reviewId} className="rounded-xl border border-[#d7e5d7] bg-white p-3">
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e6f0e7] text-xs font-bold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-bold">{i + 1}. {row.name || 'Unnamed item'}</p>
                  <p className="text-xs text-[#5b7762]">{row.quantity && row.unit ? `${row.quantity} ${row.unit}` : 'Quantity not identified'} · {row.expiry_date ? `Date ${row.expiry_date}` : 'Expiry unknown'}</p>
                  <p className={`text-xs font-semibold ${row.status === 'saved' ? 'text-[#277251]' : isReady ? 'text-[#277251]' : 'text-[#ac6d25]'}`}>{row.status === 'saved' ? 'Saved' : row.status === 'uncertain' ? 'Verify in Pantry before retrying' : !row.selected ? 'Removed from this bill' : isReady ? 'Ready to save' : 'Needs review'}</p>
                </div>
                <div className="flex flex-col gap-1">
                  {row.status === 'pending' && <button type="button" disabled={saving} onClick={() => updateRow(row._reviewId, 'selected', !row.selected)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-[#84612e]">{row.selected ? 'Remove' : 'Undo remove'}</button>}
                  <button type="button" disabled={saving || !row.selected || row.status !== 'pending'} onClick={() => toggleExpanded(row._reviewId)} className="min-h-10 rounded-lg border border-[#b8d6be] px-3 text-sm font-semibold">{isOpen ? 'Done' : 'Edit'}</button>
                </div>
              </div>
              {row.status === 'pending' && row.selected && <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="min-h-11 rounded-xl bg-[#287b50] px-2 text-xs font-bold text-white disabled:opacity-50" disabled={saving || labelBusy !== null} onClick={() => { setCameraRowId(row._reviewId); setCameraFacing('environment'); }}><Camera size={15} className="mr-1 inline" />Take date photo</button>
                <label className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#287b50] px-2 text-center text-xs font-semibold text-[#287b50] ${saving || labelBusy !== null ? 'opacity-50' : ''}`}><Camera size={15} className="mr-1 inline" />Upload label
                  <input type="file" accept="image/*" className="sr-only" disabled={saving || labelBusy !== null} onChange={event => scanLabelForRow(event, row._reviewId)} />
                </label>
              </div>}
              {labelBusy === row._reviewId && <p role="status" className="mt-2 rounded-lg bg-[#edf6ee] p-2 text-xs">Reading this item's printed date label...</p>}
              {row.manufactured_date && <p className="mt-1 text-xs text-[#647a68]">MFG / packed on: <strong>{row.manufactured_date}</strong> (review only)</p>}
              {row.labelCandidates?.length === 1 && row.expiry_date && <p className="mt-1 text-xs font-semibold text-[#287b50]">Label OCR prefilled {row.date_type?.replace('_',' ')}: {row.expiry_date} — verify before saving</p>}
              {isOpen && <div className="mt-3 space-y-2 border-t border-[#edf1ed] pt-3">
                <label className="block text-sm">Name<input className={inputStyle} maxLength={80} value={row.name || ''} disabled={row.status !== 'pending' || saving} onChange={e => updateRow(row._reviewId, 'name', e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-sm">Quantity<input className={inputStyle} type="number" min="0.01" step="any" inputMode="decimal" value={row.quantity ?? ''} disabled={row.status !== 'pending' || saving} onChange={e => updateRow(row._reviewId, 'quantity', e.target.value)} /></label>
                <label className="text-sm">Unit<select className={inputStyle} value={row.unit || ''} disabled={row.status !== 'pending' || saving} onChange={e => updateRow(row._reviewId, 'unit', e.target.value)}><option value="">Select</option>{['g','kg','ml','l','pcs'].map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label></div>
                <div className="grid grid-cols-2 gap-2"><label className="text-sm">Printed expiry (optional)<input className={inputStyle} type="date" value={row.expiry_date || ''} disabled={row.status !== 'pending' || saving} onChange={e => updateRow(row._reviewId, 'expiry_date', e.target.value)} /></label>
                <label className="text-sm">Date type<select className={inputStyle} value={row.date_type || 'unknown'} disabled={row.status !== 'pending' || saving} onChange={e => updateRow(row._reviewId, 'date_type', e.target.value)}><option value="unknown">Unknown</option><option value="expiry">Expiry</option><option value="use_by">Use by</option><option value="best_before">Best before</option></select></label></div>
                {row.labelCandidates?.length > 1 && <div className="rounded-lg bg-[#fff3df] p-2"><p className="text-xs">Several printed dates were found. Choose the relevant date for this product:</p>{row.labelCandidates.map((candidate, n) => <button type="button" key={`${candidate.date}-${candidate.type}-${n}`} className="mr-2 mt-2 rounded-lg border border-[#bf9c5a] px-2 py-2 text-xs" onClick={() => { updateRow(row._reviewId, 'expiry_date', candidate.date); updateRow(row._reviewId, 'date_type', candidate.type); }}>{candidate.type.replaceAll('_',' ')}: {candidate.date}</button>)}</div>}
                {row.labelText && <details className="rounded-lg bg-[#f4f7f3] p-2 text-xs"><summary>Show OCR text read from label</summary><pre className="mt-2 whitespace-pre-wrap break-words">{row.labelText}</pre></details>}
                {warnings.length > 0 && <div className="rounded-lg bg-[#fff3df] p-2 text-xs"><p>{warnings.join(' ')}</p><button type="button" className="mt-2 min-h-10 rounded-lg border border-[#b79b68] bg-white px-3 font-semibold" onClick={() => updateRow(row._reviewId, 'confirmedSuspicious', !row.confirmedSuspicious)}>{row.confirmedSuspicious ? 'Printed date verified — undo' : 'Confirm I checked the printed date'}</button></div>}
                {(checked.errors.length > 0 || dateTypeMissing) && <p className="text-xs text-[#ac6d25]">{[...checked.errors, ...(dateTypeMissing ? ['Select the printed date type or clear the date.'] : [])].join(' ')}</p>}
              </div>}
            </section>;
          })}
        </div>
        <div className="sticky bottom-0 mt-4 space-y-3 rounded-xl border border-[#d2e6d3] bg-[#f8faf7] p-3 shadow-sm">
          <p className="text-xs">{summary.ready} item(s) are ready to add together. {summary.incomplete} need more detail and will <strong>not</strong> be saved. Existing products receive a purchase batch; new products become Pantry entries.</p>
          {hasUnknownDates && <p className="rounded-lg bg-[#fff3df] p-2 text-xs text-[#815b26]">Some items have no confirmed printed expiry. They will be saved as <strong>expiry unknown</strong> and cannot receive reliable expiry-date alerts until a date is added.</p>}
          <p className="text-xs text-[#647a68]">Check the names and quantities above. Tapping the Save button is your confirmation to add all ready items. No item is saved before you tap it.</p>
          {progress && <p role="status" className="text-sm font-semibold">{progress}</p>}
          {error && <p role="alert" className="rounded-lg bg-[#fff3df] p-2 text-sm">{error}</p>}
          {summary.uncertain > 0 && <p className="text-xs text-[#a65a42]">{summary.uncertain} item(s) have an uncertain save result. Check the Pantry list before trying to re-add them.</p>}
          <button type="button" className="min-h-12 w-full rounded-xl bg-[#247a51] p-3 font-extrabold text-white disabled:opacity-50" disabled={saving || labelBusy != null || summary.ready === 0} onClick={saveReady}>{saving ? 'Saving reviewed items...' : `Save ${summary.ready} ready item(s) to Pantry`}</button>
        </div>
      </div>
      {cameraRowId !== null && <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={`Take date photo for grocery item ${cameraRowId + 1}`}>
        <div className="w-full max-w-lg rounded-2xl bg-[#f8faf7] p-4 text-[#254b37]">
          <h3 className="mb-2 text-lg font-extrabold">Take label photo · Item {cameraRowId + 1}</h3>
          <p className="mb-3 text-xs">Point at the printed MFG/PKD and EXP/use-by/best-before dates. Keep the label still and well lit.</p>
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={labelVideoRef} autoPlay playsInline muted className="aspect-[4/3] w-full object-contain" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-[13%] rounded-lg border-2 border-white/80" />
          </div>
          {cameraError && <p role="alert" className="mt-2 rounded-lg bg-[#fff3df] p-2 text-sm">{cameraError}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="min-h-11 rounded-xl border border-[#287b50] px-2 font-semibold" onClick={() => setCameraFacing(value => value === 'environment' ? 'user' : 'environment')}>Flip camera</button>
            <button type="button" className="min-h-11 rounded-xl border border-[#287b50] px-2 font-semibold" onClick={() => { setCameraRowId(null); stopLabelStream(); }}>Cancel</button>
          </div>
          <button type="button" disabled={!cameraReady || labelBusy !== null} className="mt-2 min-h-12 w-full rounded-xl bg-[#287b50] p-3 font-bold text-white disabled:opacity-50" onClick={() => void captureDatePhoto()}>{cameraReady ? 'Capture & read dates' : 'Starting camera...'}</button>
        </div>
      </div>}
    </div>
  );
}

export default function MobilePantry({
  inventory = [],
  dashboard = {},
  initialFilter = "all",
  onManage,
  onEdit,
  onDelete,
  onScanConfirmed,
  onInventoryChanged,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [auditItem, setAuditItem] = useState(null);
  const [scanForBatch, setScanForBatch] = useState(null);
  const [receiptItems, setReceiptItems] = useState(null);
  const [liveInventory, setLiveInventory] = useState(inventory);
  const [hasChanged, setHasChanged] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!hasChanged) {
      setLiveInventory(inventory);
    }
  }, [inventory, hasChanged]);

  const items = useMemo(
    () => liveInventory.map(normalizeItem),
    [liveInventory]
  );


  // Group Dashboard freshness alerts by ingredient ID.
  const freshnessAlertsByIngredient = useMemo(() => {
    const grouped = new Map();

    const alerts = [
      ...(dashboard?.expired_or_unsafe ?? []),
      ...(dashboard?.expiring_soon ?? []),
    ];

    for (const alert of alerts) {
      if (alert?.id == null || alert?.batch_id == null) {
        continue;
      }

      const ingredientId = String(alert.id);

      if (!grouped.has(ingredientId)) {
        grouped.set(ingredientId, []);
      }

      const existing = grouped.get(ingredientId);

      // Protect against the same batch appearing twice.
      if (
        !existing.some(
          entry => entry.batch_id === alert.batch_id
        )
      ) {
        existing.push(alert);
      }
    }

    return grouped;
  }, [dashboard]);


  const stats = useMemo(
    () => ({
      total: items.length,
      low: items.filter(item => item.lowStock).length,
      expiring: items.filter(
        item => item.expiring || item.expired
      ).length,
    }),
    [items]
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items
      .filter(item =>
        item.name?.toLowerCase().includes(query)
      )
      .filter(item => {
        if (filter === "low") return item.lowStock;
        if (filter === "expiring") {
          return item.expiring || item.expired;
        }
        return true;
      })
      .sort((a, b) => {
        const severity = item => {
          if (item.expired || item.outOfStock) return 0;
          if (item.expiring || item.lowStock) return 1;
          return 2;
        };

        return severity(a) - severity(b);
      });
  }, [items, search, filter]);

  const handleBatchChange = async () => {
    setHasChanged(true);
    // Persistence already succeeded; a refresh failure must never invite a duplicate retry.
    try {
      const updated = await api("/inventory");
      setLiveInventory(updated);
      if (onInventoryChanged) await onInventoryChanged();
      setNotice("Pantry and expiry information refreshed.");
    } catch {
      setNotice("Item saved, but refresh failed. Reload Pantry to see the latest total.");
    }
  };

  const handleAuditSaved = async () => {
    setHasChanged(true);
    const updated = await api("/inventory");
    setLiveInventory(updated);
    setNotice("Pantry stock reconciled successfully.");
  };

  const closeAudit = () => {
    setAuditItem(null);

    // Refresh other application sections after a stock correction.
    if (hasChanged) {
      window.location.reload();
    }
  };

  const closeBatchManager = () => {
    setSelected(null);
    setScanForBatch(null);

    // Refresh all application sections, including Dashboard
    // and Meal Planner, after batch changes.
    if (hasChanged && !onInventoryChanged) {
      window.location.reload();
    }
  };

  const handleScan = result => {
    const name = result.name?.trim().toLowerCase();

    const existing = items.find(
      item => item.name.trim().toLowerCase() === name
    );

    setScannerOpen(false);

    if (existing) {
      if (existing.unit !== result.unit) {
        // Avoid silently converting an incompatible measurement (e.g. pcs into g).
        setReceiptItems([result]);
        return;
      }
      setSelected(existing);
      setScanForBatch({
        ...result,
        quantity: result.quantity,
        date_type: result.date_type || "unknown",
        date_source: result.date_source || "unknown",
      });
      return;
    }

    if (onScanConfirmed) {
      onScanConfirmed(result);
    } else {
      setNotice(
        "New ingredient saving is not connected."
      );
    }
  };

  return (
    <div className="kspantry">
      <header className="kspantry-heading">
        <div>
          <p className="kspantry-eyebrow">MY KITCHEN</p>
          <h1>My Pantry 🌿</h1>
          <p>Know what's in your kitchen.</p>
        </div>

        <div className="kspantry-heading-icon">
          <Package size={25} />
        </div>
      </header>

      <div className="kspantry-stats">
        <div className="kspantry-stat">
          <PackageCheck size={21} />
          <strong>{stats.total}</strong>
          <span>Ingredients</span>
        </div>

        <div className="kspantry-stat">
          <AlertTriangle size={21} />
          <strong>{stats.low}</strong>
          <span>Low Stock</span>
        </div>

        <div className="kspantry-stat">
          <CalendarClock size={21} />
          <strong>{stats.expiring}</strong>
          <span>Expiry Alerts</span>
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="my-3 rounded-xl bg-[#e6f4e9] p-3 text-sm text-[#286344]"
        >
          {notice}
        </p>
      )}

      <div className="kspantry-search">
        <Search size={19} />

        <input
          type="search"
          placeholder="Search ingredients..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Search pantry ingredients"
        />

        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            <X size={17} />
          </button>
        )}
      </div>

      <div
        className="kspantry-filters"
        aria-label="Filter inventory"
      >
        {FILTERS.map(option => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? "active" : ""}
            onClick={() => setFilter(option.id)}
            aria-pressed={filter === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="kspantry-primary-actions">
        <button type="button" className="kspantry-manage" onClick={() => setScannerOpen(true)}>
          <Camera size={19} /> Scan label
        </button>
        {onManage && <button type="button" className="kspantry-manage" onClick={onManage}>
          <Plus size={19} /> Add ingredient
        </button>}
      </div>

      <div className="kspantry-list-heading">
        <div>
          <h2>Kitchen Inventory</h2>
          <p>{filteredItems.length} items displayed</p>
        </div>
      </div>

      <div className="kspantry-list">
        {filteredItems.map(item => (
          <article
            className="kspantry-item"
            key={item._key}
          >
            <div
              className="kspantry-food-icon"
              aria-hidden="true"
            >
              {ingredientIcon(item.name)}
            </div>

            <div className="kspantry-item-info">
              <h3>{item.name}</h3>

              <p>
                {item.quantity} {item.unit}
              </p>

              {item.usable_quantity < item.quantity && (
                <small>
                  Usable: {item.usable_quantity} {item.unit}
                </small>
              )}

              {item.remainingDays !== null && (
                <small>
                  {item.remainingDays < 0
                    ? "Review earliest recorded date"
                    : item.remainingDays === 0
                      ? "Earliest date is today"
                      : `Earliest date in ${item.remainingDays} days`}
                </small>
              )}


                {(freshnessAlertsByIngredient.get(String(item.id)) ?? [])
                .map(alert => {
                    const requiresReview = alert.usable === false;

                    return (
                    <div
                        key={`freshness-${alert.batch_id}`}
                        className={`mt-2 rounded-xl border p-3 text-xs ${
                        requiresReview
                            ? "border-red-200 bg-red-50 text-red-800"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                    >
                        <p className="font-bold">
                        {requiresReview
                            ? "Expiry review required"
                            : "Expiry alert · date approaching"}
                        </p>

                        <p className="mt-1 opacity-80">
                        Batch #{alert.batch_id}
                        {" · "}
                        {alert.quantity} {item.unit}
                        {" · "}
                        {String(alert.date_type || "unknown")
                            .replaceAll("_", " ")}
                        </p>

                        <p className="mt-2 leading-relaxed">
                        {alert.alert_message ||
                            "Review the recorded date and storage conditions."}
                        </p>
                    </div>
                    );
                })}
                <div className="mt-3 flex flex-wrap items-center gap-2 kspantry-action-row">
                  <button type="button" onClick={() => { setSelected(item); setScanForBatch(null); }}
                    className="rounded-xl bg-[#e4f2e8] px-3 py-2 text-sm font-bold text-[#26714a]">
                    Manage batches <ArrowRight size={15} className="inline ml-1"/>
                  </button>
                  <details className="kspantry-more-actions">
                    <summary aria-label={`More actions for ${item.name}`}>More actions</summary>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <button type="button" onClick={() => setAuditItem(item)}
                        className="flex items-center gap-1 rounded-xl bg-[#dff0e4] px-3 py-2 text-sm font-bold text-[#216d48]">
                        <ClipboardCheck size={15}/> Audit stock
                      </button>
                      {onEdit && <button type="button" onClick={() => onEdit(item)}
                        className="flex items-center gap-1 rounded-xl bg-[#edf2f0] px-3 py-2 text-sm font-bold text-[#466b55]">
                        <Pencil size={15}/> Edit details
                      </button>}
                      {onDelete && <button type="button" onClick={() => onDelete(item)}
                        className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                        <Trash2 size={15}/> Delete
                      </button>}
                    </div>
                  </details>
                </div>

            </div>

            <Status item={item} />
          </article>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <div className="kspantry-empty">
          <Package size={32} />
          <h3>No ingredients found</h3>
          <p>
            {liveInventory.length === 0
              ? "Your pantry is empty."
              : "Try changing your search or filters."}
          </p>
        </div>
      )}



      <p className="kspantry-note">
            Low-stock alerts use approximate default thresholds
            (100 g, 100 ml, or 2 pcs) unless a custom threshold is provided.
            Check Smart Shopping for meal-specific shortages.
            Purchase dates are tracked individually.
            </p>

      {scannerOpen && (
        <ExpiryScanner
          onClose={() => setScannerOpen(false)}
          onApply={handleScan}
          onReceiptReview={items => {
            setScannerOpen(false);
            setReceiptItems(items);
          }}
        />
      )}

      {receiptItems && (
        <ReceiptPantryReview
          items={receiptItems}
          inventory={liveInventory}
          onClose={() => setReceiptItems(null)}
          onChanged={handleBatchChange}
        />
      )}

      {auditItem && (
        <AuditStock
          key={auditItem.id}
          ingredient={auditItem}
          onClose={closeAudit}
          onSaved={handleAuditSaved}
        />
      )}

      {selected && (
        <PurchaseBatchManager
          key={`${selected.id}-${scanForBatch ? "scan" : "manual"}`}
          ingredient={selected}
          scanned={scanForBatch}
          onChanged={handleBatchChange}
          onClose={closeBatchManager}
        />
      )}
    </div>
  );
}
