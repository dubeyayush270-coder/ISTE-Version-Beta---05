import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScan, dateWarnings, extractDateCandidates, isValidGtin, normalizeDate, parseReceiptItems, validateScanItem, toPantryBaseUnit, createScanOnceGuard, buildPantrySavePlan, extractPackageDateDetails, quantityFromPackageText, quantityFromProductLookup, summarizeBulkReview, prepareReceiptReviewItems, combineShoppingRows } from './scannerUtils.js';

test('barcode accepted but never makes up product data', () => {
  const value = classifyScan('8901030895428');
  assert.equal(value.kind, 'barcode');
  assert.equal(value.name, undefined);
});
test('invalid GTIN checksum is detected separately from decode', () => {
  assert.equal(isValidGtin('4006381333931'), true);
  assert.equal(isValidGtin('4006381333932'), false);
});
test('arbitrary URL and random QR text cannot become a grocery item', () => {
  assert.equal(classifyScan('https://example.com/discount').kind, 'unsupported');
  assert.equal(classifyScan('JOIN WIFI').kind, 'unsupported');
});
test('grocery JSON QR supplies tentative fields for review only', () => {
  const value = classifyScan(JSON.stringify({ type: 'grocery', name: 'Rice', quantity: 2, unit: 'kg' }));
  assert.equal(value.kind, 'grocery_qr'); assert.equal(value.name, 'Rice'); assert.equal(value.quantity, '2');
});
test('invalid dates do not roll into a different month', () => {
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(normalizeDate('2026-11-20'), '2026-11-20');
});
test('manufacture dates and unlabelled receipt transaction dates excluded', () => {
  assert.deepEqual(extractDateCandidates('MFG 01/10/2026 EXP 20/11/2026').map(x => x.date), ['2026-11-20']);
  assert.deepEqual(extractDateCandidates('Bill Date: 31/10/2026\nRice 1 kg', { receipt: true }), []);
});
test('past and far future dates require confirmation', () => {
  const today = new Date(2026, 9, 31);
  assert.equal(dateWarnings('2026-01-01', today).length, 1);
  assert.equal(dateWarnings('2040-01-01', today).length, 1);
});
test('receipt parses several items and never confuses a price with quantity', () => {
  const rows = parseReceiptItems('BILL DATE 31/10/2026\nRice 1 kg 120.00\nMilk 2 x 500 ml 80.00\nOnion 54.00\nSUBTOTAL 254.00');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(0,2).map(x => [x.name,x.quantity,x.unit]), [['Rice','1','kg'], ['Milk','1000','ml']]);
  assert.equal(rows[2].quantity, '');
  assert.equal(rows[2].needsReview, true);
});
test('validation prevents missing quantity and unit', () => {
  assert.equal(validateScanItem({name:'Rice',quantity:'',unit:'kg'}).valid, false);
  assert.equal(validateScanItem({name:'Rice',quantity:'3',unit:'kg'}).valid, true);
});

test('duplicate scan callbacks accept exactly one result per session', () => {
  const guard = createScanOnceGuard();
  assert.equal(guard.accept(), true);
  assert.equal(guard.accept(), false);
  guard.reset();
  assert.equal(guard.accept(), true);
});
test('kg and litres convert to backend base units explicitly', () => {
  assert.deepEqual(toPantryBaseUnit({quantity:2,unit:'kg'}), {quantity:2000,unit:'g'});
  assert.deepEqual(toPantryBaseUnit({quantity:1.5,unit:'l'}), {quantity:1500,unit:'ml'});
});


test('existing product creates a new purchase batch, not an inventory overwrite', () => {
  const scan = {name:' Rice ', quantity: 0.5, unit:'kg', expiry_date:'2026-12-20', date_type:'best_before', barcode:'8901030895428'};
  const result = buildPantrySavePlan([{id:12,name:'rice',unit:'g',quantity:250}], scan);
  assert.equal(result.type,'batch');
  assert.equal(result.path,'/inventory/12/batches');
  assert.equal(result.payload.quantity,500);
  assert.equal(result.payload.date_type,'best_before');
  assert.equal(result.payload.barcode,'8901030895428');
  assert.equal(result.payload.name,undefined);
});

test('new grocery uses existing stock creation API with metadata and unknown date', () => {
  const result = buildPantrySavePlan([], {name:'Oats',quantity:2,unit:'pcs',expiry_date:'',date_type:'unknown'});
  assert.equal(result.type,'new');
  assert.equal(result.path,'/inventory');
  assert.equal(result.payload.name,'Oats');
  assert.equal(result.payload.unit,'pcs');
  assert.equal(result.payload.quantity,2);
  assert.equal(result.payload.expiry_date,null);
  assert.equal(result.payload.date_source,'unknown');
});

test('unit mismatch blocks stock modification', () => {
  assert.throws(() => buildPantrySavePlan([{id:5,name:'Milk',unit:'ml'}],{name:'milk',quantity:2,unit:'pcs'}), /Stock was not changed/);
});

test('overlimit quantity and invalid scan row are blocked before persistence', () => {
  assert.throws(() => buildPantrySavePlan([], {name:'Rice',quantity:1500,unit:'kg'}), /limit/);
  assert.throws(() => buildPantrySavePlan([], {name:'Rice',quantity:'',unit:'kg'}), /positive quantity/);
});

// Label camera OCR: packaging may contain multiple dates, but only labelled
// expiry-related dates can prefill the expiry input. MFG remains separate.
test('one photograph separates MFG and EXP on the same line', () => {
  const details = extractPackageDateDetails('MFG: 01/10/2026  EXP: 20/11/2026');
  assert.deepEqual(details.manufactured.map(d => d.date), ['2026-10-01']);
  assert.deepEqual(details.expiry.map(d => [d.date,d.type]), [['2026-11-20','expiry']]);
  assert.deepEqual(details.unlabelled, []);
});

test('MFD and best-before date in different lines remain distinct', () => {
  const details = extractPackageDateDetails('MFD: 01 OCT 2026\nBEST BEFORE: 01 FEB 2027');
  assert.deepEqual(details.manufactured.map(d => d.date), ['2026-10-01']);
  assert.deepEqual(details.expiry.map(d => [d.date,d.type]), [['2027-02-01','best_before']]);
});

test('dates on following lines retain MFG and use-by labels', () => {
  const details = extractPackageDateDetails('PKD\n10/10/26\nUSE BY\n09/12/26');
  assert.deepEqual(details.manufactured.map(d => d.date), ['2026-10-10']);
  assert.deepEqual(details.expiry.map(d => d.date), ['2026-12-09']);
});

test('manufacturing-only label never becomes an expiry date', () => {
  const details = extractPackageDateDetails('MANUFACTURED 02/02/2026');
  assert.deepEqual(details.manufactured.map(d => d.date), ['2026-02-02']);
  assert.deepEqual(details.expiry, []);
  assert.deepEqual(details.unlabelled, []);
});

test('unlabelled dates stay uncertain and receipt dates cannot be promoted', () => {
  const details = extractPackageDateDetails('LOT 123\n2026-11-20\nBILL DATE 31/10/2026');
  assert.deepEqual(details.manufactured, []);
  assert.deepEqual(details.expiry, []);
  assert.deepEqual(details.unlabelled.map(d => d.date), ['2026-11-20']);
});

test('invalid package dates and unrelated text are not registered', () => {
  const details = extractPackageDateDetails('MFG: 31/02/2026\nEXP: 31/11/2026\nNEW OFFER');
  assert.equal(details.manufactured.length, 0);
  assert.equal(details.expiry.length, 0);
});

// User-reported end-to-end usability gaps: do not infer pack size from barcode
// alone; prefill only when a trusted lookup or an explicit printed label supplies it.
test('product database explicit package size may prefill for review', () => {
  assert.deepEqual(quantityFromProductLookup({quantity:'150 g'}), {quantity:'150', unit:'g'});
  assert.deepEqual(quantityFromProductLookup({quantity:'2 x 75 g'}), {quantity:'150', unit:'g'});
  assert.deepEqual(quantityFromProductLookup({product_quantity:500,product_quantity_unit:'ml'}), {quantity:'500', unit:'ml'});
});
test('barcode database without size never invents quantity', () => {
  assert.equal(quantityFromProductLookup({product_name:'Choco Fills',brands:'Brand'}), null);
  assert.equal(quantityFromProductLookup({quantity:'Pack of happiness'}), null);
});
test('explicit net weight on printed label may prefill for review', () => {
  assert.deepEqual(quantityFromPackageText('MFG: 10/10/2026\nNET WT. 150 g\nUSE BY: 20/11/2026'), {quantity:'150',unit:'g'});
  assert.deepEqual(quantityFromPackageText('NET QTY: 2 x 500 ml'), {quantity:'1000',unit:'ml'});
});
test('nutritional table and conflicting weights cannot become product quantity', () => {
  assert.equal(quantityFromPackageText('Energy per 100 g 400 kcal'), null);
  assert.equal(quantityFromPackageText('NET WT: 150 g\nNET WEIGHT 200 g'), null);
});
test('both use-by and expiry are kept as separate labelled candidates', () => {
  const details=extractPackageDateDetails('PKD: 04/10/2026\nUSE BY 20/11/2026\nEXP: 21/11/2026');
  assert.deepEqual(details.manufactured.map(x=>x.date), ['2026-10-04']);
  assert.deepEqual(details.expiry.map(x=>x.type), ['use_by','expiry']);
});

test('20 receipt items with explicit quantities can be reviewed as one batch', () => {
  const rows = Array.from({length: 20}, (_, n) => ({ _reviewId:n, name:`Item ${n+1}`, quantity:'500', unit:'g', date_type:'unknown', selected:true, status:'pending' }));
  const summary = summarizeBulkReview(rows);
  assert.equal(summary.ready, 20);
  assert.equal(summary.incomplete, 0);
});
test('missing quantities are not guessed or automatically included in bulk save', () => {
  const rows = [
    { _reviewId:0, name:'Rice', quantity:1, unit:'kg', selected:true, status:'pending' },
    { _reviewId:1, name:'Onion', quantity:'', unit:'', selected:true, status:'pending' },
  ];
  assert.deepEqual(summarizeBulkReview(rows).readyIds, [0]);
  assert.equal(summarizeBulkReview(rows).incomplete, 1);
});
test('unverified suspicious expiry blocks that row, while unknown expiry remains explicit', () => {
  const today = new Date(2026, 10, 1);
  const rows = [
    { _reviewId:0, name:'Bread', quantity:1, unit:'pcs', expiry_date:'2026-01-01', date_type:'use_by', selected:true, status:'pending' },
    { _reviewId:1, name:'Oats', quantity:1, unit:'kg', expiry_date:'', date_type:'unknown', selected:true, status:'pending' },
  ];
  assert.deepEqual(summarizeBulkReview(rows, today).readyIds, [1]);
  rows[0].confirmedSuspicious = true;
  assert.deepEqual(summarizeBulkReview(rows, today).readyIds, [0,1]);
});
test('saved or uncertain rows cannot be submitted a second time', () => {
  const rows = [
    { _reviewId:0, name:'A', quantity:1, unit:'pcs', status:'saved', selected:true },
    { _reviewId:1, name:'B', quantity:1, unit:'pcs', status:'uncertain', selected:true },
    { _reviewId:2, name:'C', quantity:1, unit:'pcs', status:'pending', selected:true },
  ];
  const summary=summarizeBulkReview(rows);
  assert.equal(summary.ready, 1); assert.equal(summary.saved,1); assert.equal(summary.uncertain,1);
});

// UX regression: upload once -> one consolidated review, without selecting each item.
test('all receipt candidates enter one review even with incomplete quantities', () => {
  const rows = prepareReceiptReviewItems([
    {name:' Toor Dal ', quantity:'1', unit:'kg'},
    {name:'Onion', quantity:'', unit:''},
    {name:'Milk', quantity:'500', unit:'ml'}
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.name), ['Toor Dal','Onion','Milk']);
  assert.equal(rows[1].quantity, '');
  assert.equal(rows[1].unit, '');
  assert.equal(rows[0].expiry_date, null);
  const reviewRows = rows.map((r,i)=> ({...r, _reviewId:i, status:'pending', selected:true}));
  assert.equal(summarizeBulkReview(reviewRows).ready, 2);
  assert.equal(summarizeBulkReview(reviewRows).incomplete, 1);
});

test('receipt item removal and restoration are explicit, no duplicate saving', () => {
  const rows = prepareReceiptReviewItems([{name:'Rice',quantity:'1',unit:'kg'},{name:'Rice',quantity:'1',unit:'kg'}])
    .map((r,i)=> ({...r, _reviewId:i, status:'pending', selected:true}));
  rows[1].selected = false; // internal flag controlled by Remove/Undo button, not checkbox
  assert.deepEqual(summarizeBulkReview(rows).readyIds, [0]);
  rows[1].selected = true;
  assert.deepEqual(summarizeBulkReview(rows).readyIds, [0,1]);
  rows[0].status = 'saved';
  assert.deepEqual(summarizeBulkReview(rows).readyIds, [1]);
});


test('barcode and grocery bill go to one list without double-counting purchase quantity', () => {
  const barcode = [{ id:'scan-1', source:'barcode', barcode:'8901234567890', name:'Paneer', quantity:'200',unit:'g', expiry_date:'2026-11-20',date_type:'use_by'}];
  const bill = [{id:'receipt-1',source:'receipt',barcode:'',name:'Paneer',quantity:'400',unit:'g'}];
  const outcome = combineShoppingRows(barcode,bill);
  assert.equal(outcome.rows.length,1);
  assert.equal(outcome.merged,1);
  assert.equal(outcome.rows[0].quantity,'400');
  assert.equal(outcome.rows[0].barcode,'8901234567890');
  assert.equal(outcome.rows[0].expiry_date,'2026-11-20');
});
test('scanning same barcode twice does not queue a duplicate', () => {
  const candidate={id:'a',source:'barcode',barcode:'4006381333931',name:'Milk',quantity:'1',unit:'l'};
  const outcome = combineShoppingRows([candidate],[{...candidate,id:'b'}]);
  assert.equal(outcome.duplicates,1);
  assert.equal(outcome.rows.length,1);
});
test('two separate receipt line items do not silently merge', () => {
  const receipt=[{id:'a',source:'receipt',name:'Milk',quantity:'500',unit:'ml'}];
  const outcome=combineShoppingRows(receipt,[{id:'b',source:'receipt',name:'Milk',quantity:'1',unit:'l'}]);
  assert.equal(outcome.rows.length,2);
});
test('package OCR label dates and barcode carry into final review, no missing expiry inferred', () => {
  const rows=prepareReceiptReviewItems([
    {name:'Milk', barcode:'4006381333931',quantity:'1',unit:'l',expiry_date:'2026-11-12',date_type:'use_by',manufactured_date:'2026-11-01'},
    {name:'Rice',quantity:'2',unit:'kg'}]);
  assert.equal(rows[0].barcode,'4006381333931');
  assert.equal(rows[0].expiry_date,'2026-11-12');
  assert.equal(rows[0].manufactured_date,'2026-11-01');
  assert.equal(rows[1].expiry_date,null);
  assert.equal(rows[1].date_type,'unknown');
});
test('cross-source matching does not merge different known barcodes of same name', () => {
  const result=combineShoppingRows([
    {id:'a',source:'barcode',name:'Milk',barcode:'8901234567890',quantity:'1',unit:'l'}
  ],[{id:'b',source:'receipt',name:'Milk',barcode:'8901234567891',quantity:'1',unit:'l'}]);
  assert.equal(result.rows.length,2);
});
