// Pure parsing/validation functions for KitchenSync's existing scanner.
// No network requests and no inventory mutations happen here.

const DATE_TOKEN = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[\s/-]+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,/-]+\d{2,4})\b/gi;
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const UNITS = new Set(['g','kg','ml','l','pcs']);

export function normalizeDate(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  let day, month, year;
  let match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    [, year, month, day] = match.map(Number);
  } else {
    match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (match) {
      [, day, month, year] = match.map(Number);
    } else {
      match = value.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s,/-]+(\d{2,4})$/);
      if (!match) return null;
      day = Number(match[1]);
      month = MONTHS.indexOf(match[2].slice(0, 3).toUpperCase()) + 1;
      year = Number(match[3]);
    }
  }
  if (year < 100) year += 2000;
  if (!(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month || checked.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateLabel(text) {
  if (/\bBEST[\s-]*BEFORE\b|\bBBE\b|\bBB\b/i.test(text)) return 'best_before';
  if (/\bUSE[\s-]*BY\b/i.test(text)) return 'use_by';
  if (/\bEXP(?:IRY|IRATION)?\b|\bEXP\.?\s*DATE\b|\bEXD\b/i.test(text)) return 'expiry';
  return 'unknown';
}
const MANUFACTURING = /\b(?:MFG|MFD|MANUFACTURING(?:\s+DATE)?|MANUFACTURED(?:\s+(?:ON|DATE))?|PACK(?:ED|ING)?\s*(?:ON|DATE)?|PKD|PKG)\b/i;
const TRANSACTION = /\b(?:BILL\s+DATE|INVOICE\s+DATE|TRANSACTION\s+DATE|PURCHASE\s+DATE|RECEIPT\s+DATE)\b/i;

export function extractDateCandidates(text, { receipt = false } = {}) {
  const result = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let precedingLabel = 'unknown';
  let precedingManufacture = false;
  let precedingTransaction = false;
  for (const line of lines) {
    let lastEnd = 0;
    let matchedAny = false;
    const token = new RegExp(DATE_TOKEN.source, DATE_TOKEN.flags);
    for (const match of line.matchAll(token)) {
      matchedAny = true;
      const nearby = line.slice(lastEnd, match.index);
      // Determine the label immediately preceding this date, not just anywhere on the line.
      const isManufacturing = MANUFACTURING.test(nearby) || (lastEnd === 0 && precedingManufacture);
      const isTransaction = TRANSACTION.test(nearby) || (lastEnd === 0 && precedingTransaction);
      const type = dateLabel(nearby) !== 'unknown' ? dateLabel(nearby) : (lastEnd === 0 ? precedingLabel : 'unknown');
      lastEnd = match.index + match[0].length;
      if (isManufacturing || isTransaction) continue;
      if (receipt && type === 'unknown') continue; // Never promote a receipt transaction date.
      const normalized = normalizeDate(match[0]);
      if (!normalized) continue;
      if (!result.some(row => row.date === normalized && row.type === type)) {
        result.push({ date: normalized, type, original: match[0], source: receipt ? 'receipt_ocr' : 'package_ocr' });
      }
    }
    // A label on its own line can qualify the next line, but not unrelated later lines.
    precedingLabel = !matchedAny && !MANUFACTURING.test(line) && !TRANSACTION.test(line) ? dateLabel(line) : 'unknown';
    precedingManufacture = !matchedAny && MANUFACTURING.test(line) && dateLabel(line) === 'unknown';
    precedingTransaction = !matchedAny && TRANSACTION.test(line);
  }
  return result;
}

// A relative shelf-life phrase can establish a date only when it explicitly names
// a manufacturing/packing starting point. "After opening" and "from purchase"
// are deliberately NOT supported because they would guess a package expiry.
const SHELF_LABEL = /\b(BEST[\s-]*BEFORE|BBE?|USE[\s-]*BY|EXP(?:IRY|IRATION)?|EXD|SHELF[\s-]*LIFE)\b/i;
const SHELF_DURATION = /\b(\d{1,3})\s*(DAYS?|WEEKS?|MONTHS?|MOS?|YEARS?|YRS?)\b/i;
const SHELF_ORIGIN = /\b(?:FROM|AFTER|OF)\s+(?:(?:THE|A)\s+)?(?:(?:DATE|DT)\s+OF\s+)?(MFG|MFD|MANUFACTURE(?:D|RING)?|PRODUCTION|PACK(?:ED|ING|AGING)?|PKD|PKG)(?:\s+DATE)?\b/i;

function dateOriginKind(text) {
  const manufacturing = /\b(?:MFG|MFD|MANUFACTURE(?:D|RING)?|PRODUCTION)\b/i.test(text);
  const packing = /\b(?:PACK(?:ED|ING|AGING)?|PKD|PKG)\b/i.test(text);
  return manufacturing && packing ? 'both' : manufacturing ? 'manufacture' : packing ? 'packing' : 'unknown';
}

export function extractShelfLifeRules(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = [];
  for (let index = 0; index < lines.length; index++) {
    if (!SHELF_LABEL.test(lines[index])) continue;
    // OCR can place a heading, duration, and "from MFG" on separate lines.
    // Only look ahead two lines to avoid combining unrelated package text.
    const snippet = lines.slice(index, index + 3).join(' ');
    const label = SHELF_LABEL.exec(snippet);
    const tail = snippet.slice(label.index + label[0].length);
    const duration = SHELF_DURATION.exec(tail);
    if (!duration) continue;
    const origin = SHELF_ORIGIN.exec(tail.slice(duration.index + duration[0].length));
    if (!origin) continue;
    const amount = Number(duration[1]);
    if (!(amount >= 1)) continue;
    const labelText = label[1].replace(/[\s-]+/g, '').toUpperCase();
    const type = labelText.startsWith('BEST') || labelText.startsWith('BB') ? 'best_before'
      : labelText.startsWith('USE') ? 'use_by'
        : labelText.startsWith('EXP') ? 'expiry' : 'unknown';
    const rawUnit = duration[2].toLowerCase();
    const unit = rawUnit.startsWith('day') ? 'day'
      : rawUnit.startsWith('week') ? 'week'
        : rawUnit.startsWith('mo') ? 'month' : 'year';
    const rule = {
      amount, unit, type, originKind: dateOriginKind(origin[1]),
      original: snippet.slice(label.index, Math.min(snippet.length, label.index + label[0].length + duration.index + duration[0].length + origin.index + origin[0].length + 4)),
      source: 'printed_shelf_life'
    };
    if (!found.some(item => item.amount === amount && item.unit === unit && item.type === type)) found.push(rule);
  }
  return found;
}

// Return null rather than silently rolling Jan 31 + 1 month into March, or
// assuming a convention the packaging does not specify. The user can verify
// and enter such an ambiguous date from the package manually.
export function calculateShelfLifeDate(startDate, rule) {
  const date = normalizeDate(startDate);
  if (!date || !rule || !['best_before', 'use_by', 'expiry'].includes(rule.type)) return null;
  const amount = Number(rule.amount);
  const unit = rule.unit;
  const equivalentDays = {day: amount, week: amount * 7, month: amount * 31, year: amount * 366}[unit];
  if (!Number.isInteger(amount) || amount <= 0 || !Number.isFinite(equivalentDays) || equivalentDays > 5 * 366) return null;
  const result = new Date(`${date}T00:00:00Z`);
  const originalDay = result.getUTCDate();
  if (unit === 'day' || unit === 'week') {
    result.setUTCDate(originalDay + amount * (unit === 'week' ? 7 : 1));
  } else {
    result.setUTCMonth(result.getUTCMonth() + amount * (unit === 'year' ? 12 : 1));
    if (result.getUTCDate() !== originalDay) return null;
  }
  const value = result.toISOString().slice(0, 10);
  return normalizeDate(value) ? value : null;
}

// Date labels on packaging are not interchangeable. Keep manufactured/packed dates
// separate from expiry dates; an unknown date is never assumed to be expiry.
export function extractPackageDateDetails(text) {
  const source = String(text ?? '');
  const manufactured = [];
  let precedingManufacture = false;
  let precedingKind = 'unknown';
  for (const line of source.split(/\r?\n/)) {
    let foundToken = false;
    let lastEnd = 0;
    for (const match of line.matchAll(new RegExp(DATE_TOKEN.source, DATE_TOKEN.flags))) {
      foundToken = true;
      const prefix = line.slice(lastEnd, match.index);
      const manufacturing = MANUFACTURING.test(prefix) || (lastEnd === 0 && precedingManufacture);
      const isExpiryLabel = dateLabel(prefix) !== 'unknown';
      const isTransaction = TRANSACTION.test(prefix);
      if (manufacturing && !isExpiryLabel && !isTransaction) {
        const date = normalizeDate(match[0]);
        if (date && !manufactured.some(row => row.date === date)) {
          manufactured.push({ date, type: 'manufactured', kind: dateOriginKind(prefix) !== 'unknown' ? dateOriginKind(prefix) : precedingKind, original: match[0], source: 'package_ocr' });
        }
      }
      lastEnd = match.index + match[0].length;
    }
    precedingManufacture = !foundToken && MANUFACTURING.test(line) && dateLabel(line) === 'unknown' && !TRANSACTION.test(line);
    precedingKind = precedingManufacture ? dateOriginKind(line) : 'unknown';
  }
  const allOtherDates = extractDateCandidates(source);
  const expiry = allOtherDates.filter(row => row.type !== 'unknown');
  const unlabelled = allOtherDates.filter(row => row.type === 'unknown' && !manufactured.some(m => m.date === row.date));
  const shelfLifeRules = extractShelfLifeRules(source);
  let calculated = null;
  if (shelfLifeRules.length === 1) {
    const rule = shelfLifeRules[0];
    const starts = manufactured.filter(row => row.kind === rule.originKind || row.kind === 'both');
    if (starts.length === 1) {
      const result = calculateShelfLifeDate(starts[0].date, rule);
      if (result) calculated = {
        date: result, type: rule.type, source: 'calculated_from_package',
        start_date: starts[0].date, rule: rule.original
      };
    }
  }
  return { manufactured, expiry, unlabelled, shelfLifeRules, calculated };
}

// Choose one clear printed date first, otherwise one defensible calculation.
// Ambiguous scans are intentionally NOT auto-filled.
export function suggestPackageExpiry(details) {
  if (!details) return null;
  const printed = details.expiry || [];
  if (printed.length === 1) {
    const candidate = printed[0];
    return {
      date: candidate.date, type: candidate.type, origin: 'printed',
      conflict: Boolean(details.calculated && details.calculated.date !== candidate.date),
      requiresConfirmation: Boolean(details.calculated && details.calculated.date !== candidate.date)
    };
  }
  if (printed.length > 1 || (details.unlabelled || []).length) return null;
  if (details.calculated) {
    return {
      date: details.calculated.date, type: details.calculated.type,
      origin: 'calculated', conflict: false, requiresConfirmation: true
    };
  }
  return null;
}

// A check digit verifies syntax, NOT product identity.
export function isValidGtin(code) {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(code))) return false;
  const digits = [...String(code)].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, n, index) => acc + n * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function cleanString(value, limit = 120) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
export function classifyScan(raw) {
  const text = cleanString(raw, 2048);
  if (!text) return { kind: 'unsupported', message: 'The scan was empty.' };
  if (/^\d{8,14}$/.test(text)) {
    return { kind: 'barcode', code: text, checked: isValidGtin(text), message: isValidGtin(text)
      ? 'Barcode read. Look up the name, then confirm the package details.'
      : 'Numeric code read, but its check digit or format is unverified. Check the printed code before lookup.' };
  }
  // Deliberately do not treat random URLs, unstructured QR text, or inferred SKU as products.
  if (/^https?:\/\//i.test(text)) return { kind: 'unsupported', message: 'This QR code contains a link, not verified grocery details. Use manual entry.' };
  if (text.length <= 2048 && text.startsWith('{')) {
    try {
      const payload = JSON.parse(text);
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('No grocery object');
      if (!['grocery', 'product', 'kitchensync_grocery'].includes(String(payload.type ?? '').toLowerCase())) {
        return { kind: 'unsupported', message: 'The QR object is not explicitly marked as grocery data.' };
      }
      const name = cleanString(payload.name ?? payload.product_name);
      if (!name) return { kind: 'unsupported', message: 'The QR code lacks a product name.' };
      const rawQuantity = payload.quantity;
      const quantity = rawQuantity === undefined || rawQuantity === null || rawQuantity === '' ? '' : Number(rawQuantity);
      const unit = cleanString(payload.unit, 12).toLowerCase();
      const date = cleanString(payload.expiry_date, 30);
      return {
        kind: 'grocery_qr',
        name, barcode: /^\d{8,14}$/.test(String(payload.barcode ?? '')) ? String(payload.barcode) : '',
        quantity: Number.isFinite(quantity) && quantity > 0 ? String(quantity) : '',
        unit: UNITS.has(unit) ? unit : '',
        expiry_date: normalizeDate(date) || '',
        date_type: ['expiry','use_by','best_before'].includes(payload.date_type) ? payload.date_type : 'unknown',
        message: 'Grocery details read from QR. QR content is unverified: compare every field with the physical package.'
      };
    } catch {
      return { kind: 'unsupported', message: 'This QR payload is not valid supported grocery JSON.' };
    }
  }
  return { kind: 'unsupported', message: 'Code detected, but it does not contain a supported grocery barcode or structured grocery details.' };
}

// Open Food Facts may provide a name but no pack size. Only use explicitly
// labelled weight/quantity data; NEVER infer quantity from a barcode or price.
export function parsePackSize(value) {
  const text = String(value ?? '').trim().replace(/,/g, '.');
  if (!text || text.length > 75) return null;
  let match = text.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs?|pieces?)\.?$/i);
  let amount;
  let unit;
  if (match) { amount = Number(match[1]) * Number(match[2]); unit = match[3]; }
  else {
    match = text.match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs?|pieces?)\.?$/i);
    if (!match) return null;
    amount = Number(match[1]); unit = match[2];
  }
  unit = /^(?:pcs?|pieces?)$/i.test(unit) ? 'pcs' : unit.toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !UNITS.has(unit)) return null;
  return { quantity: String(amount), unit };
}

export function quantityFromProductLookup(product) {
  if (!product || typeof product !== 'object') return null;
  // Product quantity values can be inconsistent in external databases.
  // Prefer a complete, human-readable quantity with explicit units.
  const fromLabel = parsePackSize(product.quantity);
  if (fromLabel) return fromLabel;
  if (Number.isFinite(Number(product.product_quantity)) && product.product_quantity_unit) {
    return parsePackSize(`${product.product_quantity} ${product.product_quantity_unit}`);
  }
  return null;
}

export function quantityFromPackageText(text) {
  const choices = [];
  // Require an adjacent net quantity/weight label. An unlabelled '100 g'
  // could refer to serving size, nutritional table or other information.
  const labeled = /\b(?:NET\s*(?:WT|WGT|WEIGHT|QTY|QUANTITY|CONTENTS?)|PACK\s*(?:SIZE|WEIGHT)|PACKED\s*WEIGHT)\s*[:.\-]?\s*(\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:kg|g|ml|l|pcs?|pieces?))\b/gi;
  for (const match of String(text ?? '').matchAll(labeled)) {
    const amount = parsePackSize(match[1]);
    if (amount && !choices.some(other => other.quantity === amount.quantity && other.unit === amount.unit)) choices.push(amount);
  }
  // Do not pick one if conflicting pack sizes appear in OCR.
  return choices.length === 1 ? choices[0] : null;
}

export function dateWarnings(value, today = new Date()) {
  if (!value) return [];
  const normalized = normalizeDate(value);
  if (!normalized) return ['Enter a valid calendar date.'];
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dateUtc = Date.parse(`${normalized}T00:00:00Z`);
  const days = Math.round((dateUtc - todayUtc) / 86400000);
  const warnings = [];
  if (days < 0) warnings.push('This date has already passed. Check the package and confirm before saving.');
  if (days > 365 * 5) warnings.push('This date is more than five years away. Verify the year printed on the package.');
  return warnings;
}

const SKIP_RECEIPT = /^(?:GST(?:IN)?|CGST|SGST|IGST|HSN|SKU|TAX|SUBTOTAL|SUB\s+TOTAL|TOTAL|NET\s+TOTAL|GRAND\s+TOTAL|AMOUNT|BALANCE|CASH|CARD|UPI|PAYMENT|DISCOUNT|SAVINGS|CHANGE|INVOICE|BILL\s*(?:NO|DATE)?|RECEIPT|DATE|TIME|THANK|WELCOME|STORE|SHOP|ITEM\s+DESCRIPTION|QTY|PRICE|MRP|RATE|TEL|PHONE|ADDRESS)\b/i;
const DATE_LINE = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/;

export function parseReceiptItems(text) {
  const results = [];
  const seen = new Set();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, ' ');
    if (line.length < 3 || SKIP_RECEIPT.test(line) || DATE_LINE.test(line) || /^[-_=*#\d\s.,₹$]+$/.test(line)) continue;
    // Drop optional item numbers and terminal price, but never infer quantity from a price.
    let content = line.replace(/^\d{1,3}[.)]\s+/, '');
    content = content.replace(/\s+(?:₹|Rs\.?\s*)?\d+(?:\.\d{2})\s*$/, '');
    let name = content;
    let quantity = '';
    let unit = '';
    // Explicit pack count x size: 2 x 500 g -> 1000 g; preserve unit shown.
    let match = content.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs?|pieces?)\b/i);
    if (match) {
      name = match[1]; quantity = String(Number(match[2]) * Number(match[3])); unit = match[4].toLowerCase();
    } else {
      match = content.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs?|pieces?)\b/i);
      if (match) {
        name = match[1]; quantity = match[2]; unit = match[3].toLowerCase();
      }
    }
    unit = unit === 'piece' || unit === 'pieces' || unit === 'pc' ? 'pcs' : unit;
    name = cleanString(name.replace(/\s+[-:]$/, '').replace(/^\d+\s+/, ''), 100);
    if (!/[a-zA-Z]{2,}/.test(name) || SKIP_RECEIPT.test(name)) continue;
    const key = `${name.toLowerCase()}|${quantity}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ id: `ocr-${results.length + 1}`, name, quantity, unit, expiry_date: '', date_type: 'unknown', barcode: '', selected: true, needsReview: !quantity || !unit, raw: line });
    if (results.length >= 40) break;
  }
  return results;
}

export function validateScanItem(item, { dateRequired = false, today = new Date() } = {}) {
  const errors = [];
  const name = cleanString(item?.name);
  const quantity = Number(item?.quantity);
  const unit = String(item?.unit ?? '').toLowerCase();
  const expiry = String(item?.expiry_date ?? '').trim();
  if (!name) errors.push('Product name is required.');
  if (item?.quantity === '' || !Number.isFinite(quantity) || quantity <= 0) errors.push('Enter a positive quantity.');
  if (!UNITS.has(unit)) errors.push('Choose a valid unit.');
  if (dateRequired && !expiry) errors.push('Printed date is required.');
  if (expiry && !normalizeDate(expiry)) errors.push('Date is invalid.');
  const warnings = dateWarnings(expiry, today);
  return { valid: errors.length === 0, errors, warnings };
}

// Match the existing inventory API's base units. Do not change the amount silently:
// explicit conversion is shown again in the Pantry review before final save.
export function toPantryBaseUnit(item) {
  const quantity = Number(item.quantity);
  const unit = String(item.unit || '').toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be positive.');
  if (!UNITS.has(unit)) throw new Error('Unsupported unit.');
  const conversions = { kg: ['g', 1000], l: ['ml', 1000] };
  const [convertedUnit, factor] = conversions[unit] || [unit, 1];
  return { ...item, quantity: quantity * factor, unit: convertedUnit };
}

export function isDifferentProductBarcode(previous, next) {
  const oldCode = String(previous ?? '').trim();
  return oldCode !== '' && oldCode !== String(next ?? '').trim();
}

// Repeated decode callbacks from the camera should be accepted once per scan session.
export function createScanOnceGuard() {
  let accepted = false;
  return {
    accept() { if (accepted) return false; accepted = true; return true; },
    reset() { accepted = false; }
  };
}


// Resolve against a fresh inventory list at the moment a user confirms a save.
// Match is name-based: UPC identity is not exposed by the stock-list API.
export function buildPantrySavePlan(inventory, item) {
  const checked = validateScanItem(item);
  if (!checked.valid) throw new Error(checked.errors.join(' '));
  const normalized = toPantryBaseUnit(item);
  if (!Number.isFinite(normalized.quantity) || normalized.quantity > 1_000_000) {
    throw new Error('Quantity is above the allowed Pantry limit.');
  }
  const name = String(item.name).trim().replace(/\s+/g, ' ');
  if (name.length > 80) throw new Error('Ingredient name must have 80 characters or fewer.');
  const match = (inventory ?? []).find(entry =>
    String(entry.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (match && match.unit !== normalized.unit) {
    throw new Error(`Existing \"${match.name}\" uses ${match.unit}, but this scan uses ${normalized.unit}. Change the unit or product name after checking the package. Stock was not changed.`);
  }
  const common = {
    quantity: normalized.quantity,
    expiry_date: item.expiry_date || null,
    date_type: item.expiry_date ? (item.date_type || 'unknown') : 'unknown',
    date_source: item.expiry_date ? 'user_confirmed' : 'unknown',
    barcode: String(item.barcode || '').trim() || null,
    purchase_date: item.purchase_date || null,
  };
  return match
    ? { type: 'batch', ingredient: match, path: `/inventory/${match.id}/batches`, payload: common }
    : { type: 'new', ingredient: null, path: '/inventory', payload: {
      ...common, name, unit: normalized.unit, is_leftover: false
    }};
}

// A receipt is one shopping trip: every OCR candidate stays in the same
// combined review. Missing fields remain blank; no item is auto-saved.
// A barcode and a bill can describe the SAME purchased item. Merge the two
// sources without summing them: a bill typically describes the total bought,
// while the barcode lookup describes just ONE package. Duplicate scans are ignored.
export function combineShoppingRows(existing, incoming) {
  const rows = [...(existing ?? [])];
  let added = 0, merged = 0, duplicates = 0;
  for (const candidate of incoming ?? []) {
    const next = { ...candidate, selected: candidate.selected !== false };
    const code = String(next.barcode ?? '').trim();
    const name = String(next.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const source = next.source || 'receipt';
    const index = rows.findIndex(item => {
      const existingCode = String(item.barcode ?? '').trim();
      if (code && existingCode && code === existingCode) return true;
      const existingName = String(item.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      // Only merge equal names across input methods; two receipt lines might be
      // separate batches with different expiry dates and must remain separate.
      return Boolean(name && name === existingName && source !== (item.source || 'receipt') &&
        source !== 'combined' && item.source !== 'combined' && (!code || !existingCode || code === existingCode));
    });
    if (index < 0) { rows.push(next); added++; continue; }
    const previous = rows[index];
    if (code && String(previous.barcode || '') === code && source === 'barcode' && previous.source !== 'receipt') {
      duplicates++;
      continue;
    }
    // A receipt has the shopping-trip total, while a barcode has pack size.
    // Prefer explicitly read receipt totals. Never add the two quantities.
    const fromReceipt = source === 'receipt' && next.quantity && next.unit;
    rows[index] = {
      ...previous,
      name: previous.name || next.name,
      barcode: previous.barcode || next.barcode || '',
      quantity: fromReceipt ? next.quantity : (previous.quantity || next.quantity || ''),
      unit: fromReceipt ? next.unit : (previous.unit || next.unit || ''),
      expiry_date: previous.expiry_date || next.expiry_date || '',
      date_type: previous.expiry_date ? previous.date_type : (next.date_type || 'unknown'),
      manufactured_date: previous.manufactured_date || next.manufactured_date || '',
      labelCandidates: previous.labelCandidates?.length ? previous.labelCandidates : next.labelCandidates || [],
      labelText: previous.labelText || next.labelText || '',
      source: 'combined',
      raw: [previous.raw, next.raw].filter(Boolean).join(' | ').slice(0, 400)
    };
    merged++;
  }
  return { rows, added, merged, duplicates };
}

// Keep dates already read from the physical package while moving from scanner
// to the final combined review. No invented dates or missing quantities.
export function prepareReceiptReviewItems(rows) {
  return (rows ?? []).map(row => ({
    name: String(row.name ?? '').trim(),
    quantity: row.quantity ?? '',
    unit: String(row.unit ?? '').trim(),
    barcode: String(row.barcode ?? '').trim(),
    expiry_date: row.expiry_date || null,
    date_type: row.expiry_date ? (row.date_type || 'unknown') : 'unknown',
    date_source: row.expiry_date ? 'user_confirmed' : 'unknown',
    manufactured_date: row.manufactured_date || '',
    labelCandidates: row.labelCandidates || [],
    labelText: row.labelText || '',
    selected: row.selected !== false,
    source: row.source || 'receipt'
  }));
}

// Classify scanned receipt rows before offering one batch confirmation.
// Incomplete/unsafe rows remain editable and are never sent to Pantry.
export function summarizeBulkReview(rows, today = new Date()) {
  const readyIds = [];
  let incomplete = 0, saved = 0, uncertain = 0, excluded = 0;
  for (const row of rows ?? []) {
    if (row.status === 'saved') { saved += 1; continue; }
    if (row.status === 'uncertain') { uncertain += 1; continue; }
    if (!row.selected) { excluded += 1; continue; }
    const result = validateScanItem(row, { today });
    const dateTypeMissing = Boolean(row.expiry_date && !['expiry', 'use_by', 'best_before'].includes(row.date_type));
    const suspicious = dateWarnings(row.expiry_date, today).length > 0 && !row.confirmedSuspicious;
    if (!result.valid || dateTypeMissing || suspicious) incomplete += 1;
    else readyIds.push(row._reviewId);
  }
  return { ready: readyIds.length, readyIds, incomplete, saved, uncertain, excluded };
}

// Collect evidence from multiple OCR passes and multiple photos. Neither a repeated
// OCR read nor two images can prove a date was printed correctly: ALWAYS review.
// Conflicting values remain visible, never silently choose one.
export function mergePackageOcrReadings(readings = []) {
  const groups = { manufactured: new Map(), expiry: new Map(), unlabelled: new Map(), shelfLifeRules: new Map() };
  const photoIds = new Set();
  for (const reading of readings) {
    if (!reading || typeof reading.text !== 'string' || !reading.text.trim()) continue;
    const photoId = String(reading.photoId ?? 'unknown');
    photoIds.add(photoId);
    const pass = String(reading.pass ?? 'original');
    const details = extractPackageDateDetails(reading.text);
    for (const key of ['manufactured', 'expiry', 'unlabelled', 'shelfLifeRules']) {
      for (const item of details[key]) {
        const fingerprint = key === 'shelfLifeRules'
          ? `${item.type}|${item.amount}|${item.unit}|${item.originKind}`
          : `${item.date}|${item.type}|${item.kind || ''}`;
        if (!groups[key].has(fingerprint)) groups[key].set(fingerprint, { ...item, evidence: [], confidence: 'low' });
        const row = groups[key].get(fingerprint);
        if (!row.evidence.some(source => source.photoId === photoId && source.pass === pass)) {
          row.evidence.push({ photoId, pass, text: item.original });
        }
      }
    }
  }
  const graded = key => [...groups[key].values()].map(row => {
    const photos = new Set(row.evidence.map(v => v.photoId)).size;
    return { ...row, confidence: photos >= 2 ? 'high' : row.evidence.length >= 2 ? 'medium' : 'low' };
  });
  const manufactured = graded('manufactured');
  const expiry = graded('expiry');
  const unlabelled = graded('unlabelled');
  const shelfLifeRules = graded('shelfLifeRules');
  let calculated = null;
  if (shelfLifeRules.length === 1) {
    const rule = shelfLifeRules[0];
    const starts = manufactured.filter(row => row.kind === rule.originKind || row.kind === 'both');
    if (starts.length === 1) {
      const date = calculateShelfLifeDate(starts[0].date, rule);
      if (date) calculated = {
        date, type: rule.type, source: 'calculated_from_package',
        start_date: starts[0].date, rule: rule.original,
        confidence: starts[0].confidence === 'low' || rule.confidence === 'low' ? 'low' : 'medium',
        evidence: [...starts[0].evidence, ...rule.evidence]
      };
    }
  }
  const distinctExpiry = new Set(expiry.map(item => `${item.date}|${item.type}`));
  const manufacturedGroup = manufactured.filter(row => row.kind === 'manufacture');
  const packingGroup = manufactured.filter(row => row.kind === 'packing');
  const ambiguousGroup = manufactured.filter(row => row.kind !== 'manufacture' && row.kind !== 'packing');
  const conflictingStarts = manufacturedGroup.length > 1 || packingGroup.length > 1 || ambiguousGroup.length > 1;
  const conflicting = distinctExpiry.size > 1 || conflictingStarts || shelfLifeRules.length > 1 || Boolean(calculated && expiry.some(row => row.date !== calculated.date));
  return { manufactured, expiry, unlabelled, shelfLifeRules, calculated, conflicting, photoCount: photoIds.size };
}

// Returns the exact set of photo IDs and confidence for a suggested date.
export function describeExpiryEvidence(details, suggestion) {
  if (!suggestion) return { confidence: 'none', photoIds: [], reason: 'No unambiguous expiry evidence' };
  const rows = suggestion.origin === 'calculated'
    ? (details?.calculated ? [details.calculated] : [])
    : (details?.expiry ?? []).filter(row => row.date === suggestion.date && row.type === suggestion.type);
  const photoIds = [...new Set(rows.flatMap(row => (row.evidence || []).map(item => item.photoId)))];
  const confidence = suggestion.conflict || details?.conflicting ? 'review' : (rows[0]?.confidence || 'low');
  const reason = suggestion.origin === 'calculated' ? 'Calculated using an explicit printed shelf-life rule' : 'Read from a labelled package date';
  return { confidence, photoIds, reason };
}
