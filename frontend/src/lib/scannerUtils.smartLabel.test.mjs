import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScan, dateWarnings, extractDateCandidates, isValidGtin, normalizeDate, parseReceiptItems, validateScanItem, toPantryBaseUnit, createScanOnceGuard, buildPantrySavePlan, extractPackageDateDetails, calculateShelfLifeDate, suggestPackageExpiry, isDifferentProductBarcode, mergePackageOcrReadings, describeExpiryEvidence } from './scannerUtils.js';

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

// Explicit shelf-life automation: no data is inferred from product identity or prices.
test('package MFG plus best-before months produces a reviewable calculated date', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026  BEST BEFORE 6 MONTHS FROM MFG');
  assert.equal(details.manufactured[0].date, '2026-10-15');
  assert.equal(details.calculated.date, '2027-04-15');
  assert.equal(details.calculated.type, 'best_before');
  assert.deepEqual(suggestPackageExpiry(details), {
    date: '2027-04-15', type: 'best_before', origin: 'calculated', conflict: false, requiresConfirmation: true
  });
});

test('separate lines with date-of-packing rule calculate correctly', () => {
  const details = extractPackageDateDetails('PACKED ON: 15 Oct 2026\nBEST BEFORE\n6 MONTHS FROM DATE OF PACKING');
  assert.equal(details.manufactured[0].date, '2026-10-15');
  assert.equal(details.calculated.date, '2027-04-15');
});

test('explicit printed use-by takes precedence over calculated shelf life', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nUSE BY: 15/04/2027\nUSE BY 6 MONTHS FROM MFG');
  const suggestion = suggestPackageExpiry(details);
  assert.equal(suggestion.date, '2027-04-15');
  assert.equal(suggestion.origin, 'printed');
  assert.equal(suggestion.conflict, false);
});

test('printed expiry conflicting with calculation requires explicit confirmation', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nEXP: 20/04/2027\nEXPIRY 6 MONTHS FROM MFG');
  assert.equal(suggestPackageExpiry(details).date, '2027-04-20');
  assert.equal(suggestPackageExpiry(details).conflict, true);
  assert.equal(suggestPackageExpiry(details).requiresConfirmation, true);
});

test('best-before from opening date cannot infer a date', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nBEST BEFORE 6 MONTHS FROM OPENING');
  assert.equal(details.shelfLifeRules.length, 0);
  assert.equal(details.calculated, null);
  assert.equal(suggestPackageExpiry(details), null);
});

test('receipt transaction date is not a shelf-life starting point', () => {
  const details = extractPackageDateDetails('BILL DATE: 15/10/2026\nBEST BEFORE 6 MONTHS FROM MFG');
  assert.deepEqual(details.manufactured, []);
  assert.equal(details.calculated, null);
});

test('shelf-life only is not automatically converted to expiry type', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nSHELF LIFE 6 MONTHS FROM MFG');
  assert.equal(details.shelfLifeRules.length, 1);
  assert.equal(details.calculated, null);
});

test('days, weeks and years calculate with UTC calendar dates', () => {
  assert.equal(calculateShelfLifeDate('2026-10-15', {type:'expiry',amount:90,unit:'day'}), '2027-01-13');
  assert.equal(calculateShelfLifeDate('2026-10-15', {type:'use_by',amount:2,unit:'week'}), '2026-10-29');
  assert.equal(calculateShelfLifeDate('2026-10-15', {type:'best_before',amount:1,unit:'year'}), '2027-10-15');
});

test('ambiguous end-of-month and leap-day calculations never invent dates', () => {
  assert.equal(calculateShelfLifeDate('2027-01-31', {type:'best_before',amount:1,unit:'month'}), null);
  assert.equal(calculateShelfLifeDate('2028-02-29', {type:'best_before',amount:1,unit:'year'}), null);
});

test('missing or ambiguous MFG is not used for automatic calculation', () => {
  const missing = extractPackageDateDetails('BEST BEFORE 6 MONTHS FROM MFG');
  const ambiguous = extractPackageDateDetails('MFG: 15/10/2026\nMFG: 20/10/2026\nBEST BEFORE 6 MONTHS FROM MFG');
  assert.equal(missing.calculated, null);
  assert.equal(ambiguous.manufactured.length, 2);
  assert.equal(ambiguous.calculated, null);
});

test('two conflicting relative shelf-life rules cannot be chosen automatically', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nBEST BEFORE 6 MONTHS FROM MFG\nBEST BEFORE 9 MONTHS FROM MFG');
  assert.equal(details.calculated, null);
  assert.equal(suggestPackageExpiry(details), null);
});

test('invalid complete dates and unrelated QR content do not generate expiry', () => {
  const details = extractPackageDateDetails('MFG: 31/02/2026\nBEST BEFORE 6 MONTHS FROM MFG');
  assert.equal(details.calculated, null);
  assert.equal(classifyScan('https://example.com/item').kind, 'unsupported');
});

test('relative shelf-life over five years is not auto-calculated', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nBEST BEFORE 8 YEARS FROM MFG');
  assert.equal(details.calculated, null);
});

test('barcode added after a label photo keeps dates; changing product barcode clears them', () => {
  assert.equal(isDifferentProductBarcode('', '8901030895428'), false);
  assert.equal(isDifferentProductBarcode('8901030895428', '8901030895428'), false);
  assert.equal(isDifferentProductBarcode('8901030895428', '4006381333931'), true);
  assert.equal(isDifferentProductBarcode('8901030895428', ''), true);
});

test('packing-origin shelf life never uses an MFG-only date', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nBEST BEFORE 6 MONTHS FROM PACKING');
  assert.equal(details.calculated, null);
});

test('when MFG and PKD differ, the rule uses the correct named starting date', () => {
  const details = extractPackageDateDetails('MFG: 15/10/2026\nPKD: 20/10/2026\nBEST BEFORE 6 MONTHS FROM PACKING');
  assert.equal(details.manufactured.length, 2);
  assert.equal(details.calculated.start_date, '2026-10-20');
  assert.equal(details.calculated.date, '2027-04-20');
});


test('combines MFG and EXP from two photographs without inventing missing data', () => {
  const details = mergePackageOcrReadings([
    {photoId:'front',pass:'original',text:'MFG: 15/10/2026'},
    {photoId:'back',pass:'original',text:'EXP: 15/04/2027'}
  ]);
  assert.equal(details.manufactured.length,1);
  assert.equal(details.expiry.length,1);
  assert.equal(suggestPackageExpiry(details).date,'2027-04-15');
  assert.equal(describeExpiryEvidence(details, suggestPackageExpiry(details)).confidence,'low');
});

test('same date from two independent photos is stronger evidence but still only a suggestion', () => {
  const details = mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'USE BY: 15/04/2027'},
    {photoId:'b',pass:'enlarged-gray',text:'USE BY: 15/04/2027'}
  ]);
  const selection = suggestPackageExpiry(details);
  assert.equal(selection.date,'2027-04-15');
  assert.equal(describeExpiryEvidence(details,selection).confidence,'high');
  assert.deepEqual(describeExpiryEvidence(details,selection).photoIds,['a','b']);
});

test('OCR variations of the SAME photo are not counted as independent photographs', () => {
  const details = mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'EXP: 15/04/2027'},
    {photoId:'a',pass:'high-contrast',text:'EXP: 15/04/2027'}
  ]);
  assert.equal(describeExpiryEvidence(details,suggestPackageExpiry(details)).confidence,'medium');
});

test('conflicting printed dates never auto select a winner', () => {
  const details = mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'EXP: 15/04/2027'},
    {photoId:'b',pass:'enlarged-gray',text:'EXP: 16/04/2027'}
  ]);
  assert.equal(details.conflicting,true);
  assert.equal(suggestPackageExpiry(details),null);
  assert.equal(details.expiry.length,2);
});

test('MFG and explicit shelf life on separate photos can calculate a suggested best before', () => {
  const details = mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'MFG: 15/10/2026'},
    {photoId:'b',pass:'original',text:'BEST BEFORE 6 MONTHS FROM MFG'}
  ]);
  assert.equal(details.calculated.date,'2027-04-15');
  assert.equal(suggestPackageExpiry(details).origin,'calculated');
});

test('unlabelled transaction date and manufactured date never become expiry', () => {
  const details = mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'MFG: 15/10/2026'},
    {photoId:'b',pass:'original',text:'BILL DATE: 01/11/2026'}
  ]);
  assert.equal(details.expiry.length,0);
  assert.equal(suggestPackageExpiry(details),null);
});

test('MFG and PKD dates may legitimately differ, without being flagged as conflicting OCR',()=>{
  const details=mergePackageOcrReadings([
    {photoId:'a',pass:'original',text:'MFG: 15/10/2026'},
    {photoId:'b',pass:'original',text:'PKD: 20/10/2026'},
    {photoId:'c',pass:'original',text:'BEST BEFORE 6 MONTHS FROM PACKING'}
  ]);
  assert.equal(details.conflicting,false);
  assert.equal(details.calculated.date,'2027-04-20');
});

test('EXD and abbreviated BB shelf-life labels are recognized',()=>{
  assert.equal(extractPackageDateDetails('EXD: 15/04/2027').expiry[0].date,'2027-04-15');
  const details=extractPackageDateDetails('MFG: 15/10/2026\nBB 6 MONTHS FROM MFG');
  assert.equal(details.calculated.date,'2027-04-15');
  assert.equal(details.calculated.type,'best_before');
});
