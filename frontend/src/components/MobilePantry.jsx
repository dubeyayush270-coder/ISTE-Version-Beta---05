
import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

import ExpiryScanner from "./ExpiryScanner.jsx";
import { api } from "../lib/api";
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
    setError("");
    setFormOpen(true);
  };

  const startEdit = batch => {
    setEditingId(batch.id);
    setDraft(batchDraft(batch));
    setError("");
    setFormOpen(true);
  };

  const cancelForm = () => {
    setEditingId(null);
    setDraft(batchDraft());
    setError("");
    setFormOpen(false);
  };

  const saveBatch = async event => {
    event.preventDefault();

    const quantity = Number(draft.quantity);

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

      await loadBatches();
      await onChanged();

      setFormOpen(false);
      setEditingId(null);
      setDraft(batchDraft());
    } catch (err) {
      setError(
        err.message || "Failed to save purchase batch."
      );
    } finally {
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
                  onChange={e =>
                    change("expiry_date", e.target.value)
                  }
                />
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


export default function MobilePantry({
  inventory = [],
  dashboard = {},
  onManage,
  onEdit,
  onDelete,
  onScanConfirmed,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [scanForBatch, setScanForBatch] = useState(null);
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
    const updated = await api("/inventory");
    setLiveInventory(updated);
    setNotice("Purchase batches updated successfully.");
  };

  const closeBatchManager = () => {
    setSelected(null);
    setScanForBatch(null);

    // Refresh all application sections, including Dashboard
    // and Meal Planner, after batch changes.
    if (hasChanged) {
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
      setSelected(existing);
      setScanForBatch({
        ...result,
        quantity: "",
        date_type: result.date_type || "unknown",
        date_source: result.date_source || "user_confirmed",
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
                            ? "Review purchase batch"
                            : "Date approaching"}
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
                        <div className="mt-2 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => {
                            setSelected(item);
                            setScanForBatch(null);
                            }}
                            className="rounded-xl bg-[#e4f2e8] px-3 py-2 text-xs font-bold text-[#26714a]"
                        >
                            Manage Batches
                        </button>

                        {onEdit && (
                            <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="flex items-center gap-1 rounded-xl bg-[#edf2f0] px-3 py-2 text-xs font-bold text-[#466b55]"
                            aria-label={`Edit ${item.name}`}
                            >
                            <Pencil size={14} />
                            Edit
                            </button>
                        )}

                {onDelete && (
                    <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
                    aria-label={`Delete ${item.name}`}
                    >
                    <Trash2 size={14} />
                    Delete
                    </button>
                )}
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

      <button
        type="button"
        className="kspantry-manage"
        onClick={() => setScannerOpen(true)}
      >
        <Camera size={19} />
        Scan Barcode / Expiry Label
      </button>

      {onManage && (
        <button
          type="button"
          className="kspantry-manage"
          onClick={onManage}
        >
          Manage Pantry Items
          <ArrowRight size={18} />
        </button>
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
