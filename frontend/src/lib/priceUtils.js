// Price comparisons use only user-entered offers. No generated or live prices.
// KitchenSync inventory units are g, ml, and pcs; pack sizes may be kg or L.

export const PRICE_STORAGE_KEY = 'kitchensync:shopping:manual-prices:v1';

const PACKAGE_UNITS = {
  g: [
    { value: 'g', label: 'g' },
    { value: 'kg', label: 'kg' },
  ],
  ml: [
    { value: 'ml', label: 'ml' },
    { value: 'L', label: 'L' },
  ],
  pcs: [{ value: 'pcs', label: 'pieces' }],
};

const PACK_CONVERSIONS = { g: 1, kg: 1000, ml: 1, L: 1000, pcs: 1 };
const NORMALIZED_UNITS = { g: 'kg', ml: 'L', pcs: 'piece' };
const NORMALIZED_SCALES = { g: 1000, ml: 1000, pcs: 1 };

export function packUnitsFor(inventoryUnit) {
  return PACKAGE_UNITS[inventoryUnit] || [];
}

export function offerKey(name, unit) {
  return `${String(name || '').trim().toLocaleLowerCase()}::${String(unit || '').trim()}`;
}

export function normalizeOfferPrice({ inventoryUnit, packUnit, packQuantity, price }) {
  if (!PACKAGE_UNITS[inventoryUnit]) {
    throw new Error('Only g, ml and pieces are supported for comparison.');
  }
  if (!PACKAGE_UNITS[inventoryUnit].some((option) => option.value === packUnit)) {
    throw new Error(`Package unit ${packUnit} is not compatible with inventory unit ${inventoryUnit}.`);
  }

  const quantity = Number(packQuantity);
  const rupees = Number(price);
  if (String(packQuantity).trim() === '' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
    throw new Error('Enter a package quantity greater than zero and no more than 1,000,000.');
  }
  if (String(price).trim() === '' || !Number.isFinite(rupees) || rupees <= 0 || rupees > 1_000_000) {
    throw new Error('Enter a total package price greater than zero and no more than ₹10,00,000.');
  }

  const quantityInInventoryUnit = quantity * PACK_CONVERSIONS[packUnit];
  const pricePerUnit = (rupees / quantityInInventoryUnit) * NORMALIZED_SCALES[inventoryUnit];
  return {
    quantityInInventoryUnit,
    pricePerUnit,
    normalizedUnit: NORMALIZED_UNITS[inventoryUnit],
  };
}

export function sortOffersByValue(offers, selectedKey) {
  return (Array.isArray(offers) ? offers : [])
    .filter((offer) => offer?.itemKey === selectedKey && offer?.source === 'manual')
    .map((offer) => {
      try {
        return { ...offer, comparison: normalizeOfferPrice({
          inventoryUnit: offer.inventoryUnit,
          packUnit: offer.packUnit,
          packQuantity: offer.packQuantity,
          price: offer.price,
        }) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.comparison.pricePerUnit - b.comparison.pricePerUnit);
}

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatRupees(value) {
  return rupeeFormatter.format(Number(value) || 0);
}

export function formatNormalizedPrice(comparison) {
  return `${formatRupees(comparison.pricePerUnit)} / ${comparison.normalizedUnit}`;
}

export function createManualOffer({ item, store, packUnit, packQuantity, price }, id, now) {
  if (!item?.name || !item?.unit) throw new Error('Choose an ingredient from the shopping list.');
  const storeLabel = String(store || '').trim();
  if (!storeLabel || storeLabel.length > 70) throw new Error('Enter a store or seller name (up to 70 characters).');
  const normalized = normalizeOfferPrice({ inventoryUnit: item.unit, packUnit, packQuantity, price });
  return {
    id,
    itemKey: offerKey(item.name, item.unit),
    ingredient: item.name,
    inventoryUnit: item.unit,
    store: storeLabel,
    packUnit,
    packQuantity: Number(packQuantity),
    price: Number(price),
    source: 'manual',
    recordedAt: now,
    // Reference only; the source of truth for computations is normalized from the saved inputs.
    normalizedUnit: normalized.normalizedUnit,
  };
}
