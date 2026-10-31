import ExpiryScanner from "./ExpiryScanner.jsx";

import { useMemo, useState } from "react";
import {
  Package,
  PackageCheck,
  Search,
  AlertTriangle,
  CalendarClock,
  ArrowRight,
  X,
  Camera
} from "lucide-react";

import "./MobilePantry.css";

const FILTERS = [
  { id: "all", label: "All Items" },
  { id: "low", label: "Low Stock" },
  { id: "expiring", label: "Expiring" }
];

function daysUntil(dateValue) {
  if (!dateValue) return null;

  const date = new Date(
    String(dateValue).slice(0, 10) + "T00:00:00"
  );

  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round(
    (date.getTime() - today.getTime()) / 86400000
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
  const quantity = Number(
    item.quantity ?? item.qty ?? 0
  );

  const thresholdValue =
    item.min_quantity ??
    item.minimum_quantity ??
    item.low_stock_threshold ??
    item.reorder_level;

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

  const outOfStock = quantity <= 0;

  const lowStock =
    outOfStock ||
    (threshold !== null &&
      Number.isFinite(threshold) &&
      quantity <= threshold);

  const expired =
    remainingDays !== null && remainingDays < 0;

  const expiring =
    remainingDays !== null &&
    remainingDays >= 0 &&
    remainingDays <= 3;

  return {
    ...item,
    _key: item.id ?? `${item.name}-${index}`,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unit: item.unit || "",
    remainingDays,
    outOfStock,
    lowStock,
    expired,
    expiring
  };
}

function Status({ item }) {
  if (item.expired) {
    return (
      <span className="kspantry-status danger">
        Expired
      </span>
    );
  }

  if (item.outOfStock) {
    return (
      <span className="kspantry-status danger">
        Out of stock
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

export default function MobilePantry({
  inventory = [],
  onManage,
  onScanConfirmed
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedItem, setScannedItem] = useState(null);

  const items = useMemo(
    () => inventory.map(normalizeItem),
    [inventory]
  );

  const stats = useMemo(() => ({
    total: items.length,
    low: items.filter(item => item.lowStock).length,
    expiring: items.filter(item =>
      item.expiring || item.expired
    ).length
  }), [items]);

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
            className={
              filter === option.id ? "active" : ""
            }
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

              {item.remainingDays !== null && (
                <small>
                  {item.remainingDays < 0
                    ? `Expired ${Math.abs(
                        item.remainingDays
                      )} days ago`
                    : item.remainingDays === 0
                    ? "Expires today"
                    : `Expires in ${
                        item.remainingDays
                      } days`}
                </small>
              )}
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
            {inventory.length === 0
              ? "Your pantry is empty."
              : "Try changing your search or filters."}
          </p>
        </div>
      )}

        {/* Barcode and Expiry Scanner Button */}
        <button
        type="button"
        className="kspantry-manage"
        onClick={() => setScannerOpen(true)}
        >
        <Camera size={19} />
        Scan Barcode / Expiry Label
        </button>

        {/* Display the confirmed scan result */}
        {scannedItem && (
        <div className="mt-4 rounded-2xl bg-[#e2f0e4] p-4 text-[#254b37]">
            <h3 className="mb-3 font-extrabold">
            Scanned Ingredient
            </h3>

            <p className="text-sm">
            <strong>Name:</strong> {scannedItem.name}
            </p>

            <p className="mt-2 text-sm">
            <strong>Barcode:</strong>{" "}
            {scannedItem.barcode || "Not scanned"}
            </p>

            <p className="mt-2 text-sm">
            <strong>Expiry Date:</strong>{" "}
            {scannedItem.expiry_date}
            </p>

            <p className="mt-2 text-sm">
            <strong>Date Type:</strong>{" "}
            {scannedItem.date_type.replace("_", " ")}
            </p>

            <p className="mt-3 text-xs text-[#64816b]">
            Scan confirmed. Database saving is not connected yet.
            </p>
        </div>
        )}


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
        Low-stock alerts use saved minimum quantities
        when available. Expiry alerts show items that
        expire within three days or are already expired.
      </p>


        
        {scannerOpen && (
        <ExpiryScanner
            onClose={() => setScannerOpen(false)}
            onApply={(result) => {
            if (!onScanConfirmed) {
                alert("Scanner save integration is unavailable.");
                return;
            }

            setScannerOpen(false);
            onScanConfirmed(result);
            }}
        />
        )}


    </div>
  );
}
