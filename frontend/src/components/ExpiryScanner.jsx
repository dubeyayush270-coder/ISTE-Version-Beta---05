import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import {
  ArrowLeft, Barcode, Camera, CheckCircle2, CalendarDays, Search,
  ScanLine, LoaderCircle, AlertTriangle, RefreshCw
} from 'lucide-react';
import {
  classifyScan, createScanOnceGuard, dateWarnings, extractPackageDateDetails,
  parseReceiptItems, prepareReceiptReviewItems, combineShoppingRows, quantityFromPackageText, quantityFromProductLookup, toPantryBaseUnit, validateScanItem,
  calculateShelfLifeDate, suggestPackageExpiry, isDifferentProductBarcode, mergePackageOcrReadings, describeExpiryEvidence
} from '../lib/scannerUtils.js';
import { DEFAULT_CROP, normalizeCrop, prepareLabelOcrVariants } from '../lib/labelImageProcessing.js';

const fieldClass = 'mt-1 min-h-11 w-full rounded-xl bg-[#e9f2ea] p-3 text-[#254b37] outline-none focus:ring-2 focus:ring-[#287b50]';
const greenButton = 'min-h-12 w-full rounded-xl bg-[#287b50] px-4 py-3 font-bold text-white disabled:opacity-50';
const formatCameraError = (error) => {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Camera access was denied. Allow camera permission in browser settings, or enter the code manually.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found. Enter the code manually or upload a photograph.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The camera is busy or unavailable. Close other camera apps and retry.';
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'Camera access generally requires HTTPS or localhost. Use manual entry or image upload.';
  return `Could not start camera: ${error?.message || 'unknown camera error'}. Use manual entry or retry.`;
};

/** Drop-in replacement: preserves original onClose/onApply contract.
 * Optional onReceiptReview(items) hook is for parent-level multi-item transaction flow.
 * NEVER directly mutates Pantry or invokes the inventory API.
 */
export default function ExpiryScanner({ onClose, onApply, onReceiptReview }) {
  const [cameraMode, setCameraMode] = useState(null); // 'photo' or 'code'
  const [cameraReady, setCameraReady] = useState(false);
  const [photos, setPhotos] = useState([]); // up to 4 label photographs, kept in memory only
  const photosRef = useRef([]);
  const nextPhotoIdRef = useRef(1);
  const [activePhotoId, setActivePhotoId] = useState(null);
  const [crop, setCrop] = useState({ ...DEFAULT_CROP });
  const [ocrProgress, setOcrProgress] = useState('');
  const [expiryEvidence, setExpiryEvidence] = useState(null);
  const [conflictingLabels, setConflictingLabels] = useState(false);
  const [ocrReviewNeeded, setOcrReviewNeeded] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraZoom, setCameraZoom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [dateType, setDateType] = useState('unknown');
  const [expiryDate, setExpiryDate] = useState('');
  const [manufacturedDate, setManufacturedDate] = useState('');
  const [manufacturedOrigin, setManufacturedOrigin] = useState('');
  const [packedDate, setPackedDate] = useState('');
  const [packedOrigin, setPackedOrigin] = useState('');
  const [manufactureCandidates, setManufactureCandidates] = useState([]);
  const [shelfLifeRules, setShelfLifeRules] = useState([]);
  const [calculatedDate, setCalculatedDate] = useState(null);
  const [dateOrigin, setDateOrigin] = useState('');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [receiptRows, setReceiptRows] = useState([]);
  const [scanMessage, setScanMessage] = useState('Scan barcodes to build one shopping list, or upload a bill. Product names and package sizes prefill only when lookup data is available. Photograph each label for expiry.');
  const [scanError, setScanError] = useState(false);
  const [lookupStatus, setLookupStatus] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');
  const [ocrPreviewText, setOcrPreviewText] = useState('');
  const [dateScanStatus, setDateScanStatus] = useState('');
  const barcodeRef = useRef('');
  const videoRef = useRef(null);
  const photoStreamRef = useRef(null);
  const zoomTrackRef = useRef(null);
  const ocrLockRef = useRef(false);
  const controlsRef = useRef(null);
  const scanGuardRef = useRef(createScanOnceGuard());
  const activeRef = useRef(true);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const workerRef = useRef(null);
  const submitLockRef = useRef(false);
  const intakeSequenceRef = useRef(0);

  const releaseMedia = () => {
    try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    controlsRef.current = null;
    photoStreamRef.current?.getTracks().forEach(track => track.stop());
    photoStreamRef.current = null;
    zoomTrackRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      requestIdRef.current += 1;
      abortRef.current?.abort();
      releaseMedia();
      workerRef.current?.terminate().catch(() => {});
      photosRef.current.forEach(photo => { URL.revokeObjectURL(photo.url); if (photo.cropUrl) URL.revokeObjectURL(photo.cropUrl); });
      photosRef.current = [];
    };
  }, []);

  const setPhotoCollection = next => { photosRef.current = next; setPhotos(next); };
  const clearPhotoCollection = () => {
    photosRef.current.forEach(photo => { URL.revokeObjectURL(photo.url); if (photo.cropUrl) URL.revokeObjectURL(photo.cropUrl); });
    setPhotoCollection([]); setActivePhotoId(null); setCrop({ ...DEFAULT_CROP });
    setExpiryEvidence(null); setConflictingLabels(false); setOcrReviewNeeded(false);
  };
  const applyPhotoEvidence = collection => {
    const details = mergePackageOcrReadings(collection.flatMap(photo => photo.readings));
    const selection = details.conflicting ? null : suggestPackageExpiry(details);
    const evidence = describeExpiryEvidence(details, selection);
    setCandidates([...details.expiry, ...details.unlabelled]);
    setManufactureCandidates(details.manufactured);
    setShelfLifeRules(details.shelfLifeRules);
    setCalculatedDate(details.calculated);
    setConflictingLabels(details.conflicting);
    setExpiryEvidence(selection ? evidence : null);
    setOcrReviewNeeded(Boolean(collection.length && (details.conflicting || evidence.confidence !== 'high')));
    setDateConfirmed(false);
    if (manufacturedOrigin !== 'manual') {
      const mfg = details.manufactured.filter(row => row.kind === 'manufacture');
      setManufacturedDate(mfg.length === 1 ? mfg[0].date : '');
      setManufacturedOrigin(mfg.length === 1 ? 'ocr' : '');
    }
    if (packedOrigin !== 'manual') {
      const pkd = details.manufactured.filter(row => row.kind === 'packing');
      setPackedDate(pkd.length === 1 ? pkd[0].date : '');
      setPackedOrigin(pkd.length === 1 ? 'ocr' : '');
    }
    // A user-entered date is not silently overwritten by a new photograph.
    if (dateOrigin !== 'manual') {
      setExpiryDate(selection?.date || '');
      setDateType(selection?.type || 'unknown');
      setDateOrigin(selection?.origin || '');
    }
    if (details.conflicting) {
      setScanMessage('The photographs or OCR passes disagree about the printed dates. Review every candidate and select the date from your packaging. Nothing has been saved.');
      setScanError(true);
    } else if (selection) {
      setScanMessage(`${selection.origin === 'calculated' ? 'Calculated' : 'Read'} ${selection.type.replace('_', ' ')} ${selection.date}. ${evidence.confidence} OCR support from ${evidence.photoIds.length} photograph(s). Verify the physical package before saving.`);
      setScanError(false);
    } else if (details.manufactured.length || details.shelfLifeRules.length || details.unlabelled.length) {
      setScanMessage('Some label text was found, but no unambiguous expiry date. Adjust crop, retake or add another photo. Manufacturing dates are not expiry dates.');
      setScanError(false);
    } else {
      setScanMessage('No reliable labelled dates found. Try a tighter crop, better lighting, or an additional photo. You can enter the date manually.');
      setScanError(false);
    }
  };
  const updateCropField = (field, value) => setCrop(old => normalizeCrop({ ...old, [field]: Number(value) }));
  const removePhoto = id => {
    if (ocrLockRef.current) return;
    const removed = photosRef.current.find(photo => photo.id === id);
    const next = photosRef.current.filter(photo => photo.id !== id);
    if (removed) { URL.revokeObjectURL(removed.url); if (removed.cropUrl) URL.revokeObjectURL(removed.cropUrl); }
    setPhotoCollection(next);
    if (activePhotoId === id) {
      setActivePhotoId(next.at(-1)?.id || null);
      setCrop({ ...(next.at(-1)?.crop || DEFAULT_CROP) });
    }
    applyPhotoEvidence(next);
  };

  const stopCamera = () => {
    releaseMedia();
    setCameraReady(false);
    setCameraMode(null);
    setCameraZoom(null);
  };

  useEffect(() => {
    if (!cameraMode) return undefined;
    let cancelled = false;
    scanGuardRef.current.reset();
    setCameraReady(false);
    const begin = async () => {
      try {
        if (cameraMode === 'photo') {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera capture is unavailable in this browser or insecure connection');
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
          if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
          photoStreamRef.current = stream;
          const videoTrack = stream.getVideoTracks()[0];
          zoomTrackRef.current = videoTrack || null;
          const capabilities = videoTrack?.getCapabilities?.();
          if (capabilities?.zoom && capabilities.zoom.max > capabilities.zoom.min) {
            const settings = videoTrack.getSettings?.() || {};
            setCameraZoom({ min: capabilities.zoom.min, max: capabilities.zoom.max, step: capabilities.zoom.step || 0.1, value: settings.zoom || capabilities.zoom.min });
          } else setCameraZoom(null);
          if (!videoRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setCameraReady(true);
          return;
        }
        // Barcode / QR camera mode remains separate from product-label photography.
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: facingMode } } },
          videoRef.current,
          (result, _error, liveControls) => {
            if (cancelled || !result || !scanGuardRef.current.accept()) return;
            const decoded = classifyScan(result.getText());
            if (decoded.kind === 'barcode') {
              requestIdRef.current += 1;
              abortRef.current?.abort();
              setBusy(false);
              const differentProduct = isDifferentProductBarcode(barcodeRef.current, decoded.code);
              barcodeRef.current = decoded.code;
              setBarcode(decoded.code);
              if (differentProduct) {
                setName(''); setQuantity(''); setUnit('');
                resetLabelState();
              }
              setLookupStatus('');
              // Attempt optional product lookup immediately after barcode decode.
              // A code alone never supplies a reliable product name or expiry.
              void lookupProduct(decoded.code);
            } else if (decoded.kind === 'grocery_qr') {
              requestIdRef.current += 1;
              abortRef.current?.abort();
              setBusy(false);
              if (barcodeRef.current && barcodeRef.current !== decoded.barcode) resetLabelState();
              barcodeRef.current = decoded.barcode;
              setName(decoded.name);
              setBarcode(decoded.barcode);
              setQuantity(decoded.quantity);
              setUnit(decoded.unit);
              setExpiryDate(decoded.expiry_date);
              setDateType(decoded.date_type);
              setDateConfirmed(false);
              setDateOrigin(decoded.expiry_date ? 'qr_unverified' : '');
            } else {
              // An unsupported QR code must not destroy a previously reviewed item.
            }
            setScanMessage(decoded.message);
            setScanError(decoded.kind === 'unsupported');
            try { liveControls.stop(); } catch { /* already stopped */ }
            setCameraMode(null);
          }
        );
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch (error) {
        if (cancelled) return;
        setScanMessage(formatCameraError(error));
        setScanError(true);
        setCameraMode(null);
      }
    };
    begin();
    return () => {
      cancelled = true;
      releaseMedia();
    };
  }, [cameraMode, facingMode]);

  async function captureLabelPhoto() {
    if (busy || ocrLockRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setScanMessage('Camera image is not ready. Point the camera at the printed label and try again.');
      setScanError(true);
      return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { setScanMessage('Could not capture a camera frame. Try image upload.'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Stop camera immediately after capturing; photo OCR runs on the frozen frame.
    stopCamera();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setScanMessage('Photo capture failed. Please retake the photograph.');
      setScanError(true);
      return;
    }
    await processOcrFile(blob, false);
  }

  const manualCode = value => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setBusy(false);
    // Typing a barcode digit by digit must NOT discard a label photo midway.
    // Reset only when replacing an already complete printed code with a different code.
    const previousCode = barcodeRef.current;
    const wasCompleteCode = /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(previousCode);
    const differentProduct = wasCompleteCode && !value.startsWith(previousCode) && isDifferentProductBarcode(previousCode, value);
    barcodeRef.current = value;
    setBarcode(value);
    if (differentProduct) { setName(''); setQuantity(''); setUnit(''); resetLabelState(); }
    setLookupStatus('');
  };

  const resetLabelState = () => {
    clearPhotoCollection();
    setCandidates([]); setManufactureCandidates([]); setManufacturedDate('');
    setManufacturedOrigin(''); setPackedDate(''); setPackedOrigin('');
    setShelfLifeRules([]); setCalculatedDate(null); setDateOrigin('');
    setExpiryDate(''); setDateType('unknown'); setDateConfirmed(false);
    setOcrPreviewText(''); setDateScanStatus('');
  };

  async function lookupProduct(codeOverride) {
    const decoded = classifyScan(typeof codeOverride === 'string' ? codeOverride : barcode);
    if (decoded.kind !== 'barcode') {
      setScanMessage('Enter a numeric barcode (8–14 digits). QR links and arbitrary text cannot be product barcodes.');
      setScanError(true);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setBusy(true); setLookupStatus('Looking up product (optional)...');
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(decoded.code)}?fields=product_name,brands,quantity,product_quantity,product_quantity_unit`, { signal: controller.signal });
      if (!response.ok) throw new Error('lookup unavailable');
      const data = await response.json();
      if (!activeRef.current || requestId !== requestIdRef.current) return;
      if (data.status === 1 && data.product?.product_name?.trim()) {
        setName(data.product.product_name.trim());
        const packSize = quantityFromProductLookup(data.product);
        if (packSize) {
          setQuantity(packSize.quantity);
          setUnit(packSize.unit);
        }
        setLookupStatus(packSize
          ? 'Product name and listed package size found. Verify both against the physical product; dates must be read from its label.'
          : 'Product name found, but no trustworthy package size was supplied. Verify the quantity and dates on the product.');
      } else {
        setLookupStatus('Product code decoded, but no matching named product was found online. Enter the printed name or try manual entry.');
      }
    } catch {
      if (activeRef.current && requestId === requestIdRef.current) setLookupStatus('Product lookup unavailable. Enter the name manually.');
    } finally {
      clearTimeout(timeoutId);
      if (activeRef.current && requestId === requestIdRef.current) setBusy(false);
    }
  }

  // Multi-pass label OCR; receipt OCR retains the existing barcode/receipt queue behavior.
  async function processOcrFile(file, receipt = false, replaceId = null) {
    if (!file || ocrLockRef.current) return;
    ocrLockRef.current = true;
    setBusy(true); setScanError(false);
    setOcrProgress(receipt ? 'Reading receipt...' : 'Preparing close-up OCR...');
    if (receipt) setReceiptStatus('');
    let worker = null;
    let newUrl = null;
    let newCropUrl = null;
    try {
      if (!file.type?.startsWith('image/')) throw new Error('Choose a photograph or image file.');
      worker = await createWorker('eng');
      workerRef.current = worker;
      if (receipt) {
        const result = await worker.recognize(file);
        if (!activeRef.current) return;
        const text = result.data.text || '';
        const rows = parseReceiptItems(text).map(row => ({
          ...row, id: `receipt-${++intakeSequenceRef.current}`, source: 'receipt'
        }));
        setReceiptRows(previous => combineShoppingRows(previous, rows).rows);
        setReceiptStatus(rows.length
          ? `${rows.length} receipt line(s) found and added to your grocery list. Barcode matches were combined without double-counting. Review names and quantities.`
          : 'No reliable items found. Retake a sharper receipt or scan barcodes instead. Existing list was kept.');
        setScanMessage('Receipt dates are transaction dates unless explicitly labelled. No expiry dates were inferred.');
        return;
      }
      const photoId = replaceId || `label-${nextPhotoIdRef.current++}`;
      const cropForPhoto = { ...crop };
      const variants = await prepareLabelOcrVariants(file, cropForPhoto);
      newCropUrl = URL.createObjectURL(variants[0].image);
      const readings = [];
      for (let i = 0; i < variants.length; i++) {
        setOcrProgress(`Reading close-up ${i + 1} of ${variants.length} (${variants[i].name})...`);
        const result = await worker.recognize(variants[i].image);
        if (!activeRef.current) return;
        readings.push({ photoId, pass: variants[i].name, text: result.data.text || '' });
      }
      if (!activeRef.current) return;
      newUrl = replaceId ? null : URL.createObjectURL(file);
      const previous = photosRef.current;
      const next = replaceId
        ? previous.map(photo => photo.id === replaceId ? { ...photo, readings, crop: cropForPhoto, cropUrl: newCropUrl } : photo)
        : [...previous, { id: photoId, file, url: newUrl, readings, crop: cropForPhoto, cropUrl: newCropUrl }];
      if (replaceId) {
        const old = previous.find(photo => photo.id === replaceId);
        if (old?.cropUrl) URL.revokeObjectURL(old.cropUrl);
      }
      if (next.length > 4) {
        const removed = next.splice(0, next.length - 4);
        removed.forEach(photo => { URL.revokeObjectURL(photo.url); if (photo.cropUrl) URL.revokeObjectURL(photo.cropUrl); });
      }
      setPhotoCollection(next);
      setActivePhotoId(photoId);
      applyPhotoEvidence(next);
      setOcrPreviewText(next.map(photo => photo.readings.map(row => `Photo ${photo.id} / ${row.pass}:\n${row.text.trim()}`).join('\n')).join('\n\n').slice(0, 7000));
      const printedPacks = [...new Set(readings.map(row => quantityFromPackageText(row.text)).filter(Boolean).map(value => `${value.quantity}|${value.unit}`))];
      if (printedPacks.length === 1 && !quantity && !unit) {
        const [printedQuantity, printedUnit] = printedPacks[0].split('|');
        setQuantity(printedQuantity); setUnit(printedUnit);
      }
      setDateScanStatus('Dates are suggestions extracted from label photographs. Review all printed fields and confirm before Pantry entry.');
      newUrl = null; newCropUrl = null;
    } catch (error) {
      if (newUrl) URL.revokeObjectURL(newUrl);
      if (newCropUrl) URL.revokeObjectURL(newCropUrl);
      if (activeRef.current) {
        setScanError(true);
        setScanMessage(`OCR could not read this image: ${error.message || 'unknown error'}. Retake closer with brighter lighting.`);
      }
    } finally {
      if (worker) {
        await worker.terminate().catch(() => {});
        if (workerRef.current === worker) workerRef.current = null;
      }
      ocrLockRef.current = false;
      if (activeRef.current) { setBusy(false); setOcrProgress(''); }
    }
  }

  function runOcr(event, receipt) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) void processOcrFile(file, receipt);
  }

  const dateOrderInvalid = Boolean(expiryDate && ((manufacturedDate && manufacturedDate > expiryDate) || (packedDate && packedDate > expiryDate)));
  const dateTypeMissing = Boolean(expiryDate && dateType === 'unknown');
  const calculatedConflict = Boolean(dateOrigin === 'printed' && calculatedDate && expiryDate && expiryDate !== calculatedDate.date);
  const warnings = [
    ...dateWarnings(expiryDate),
    ...(dateOrderInvalid ? ['Manufacturing or packing date comes after expiry. Correct the dates.'] : []),
    ...(calculatedConflict ? ['Printed expiry conflicts with calculated shelf-life date; verify carefully.'] : []),
    ...(dateOrigin === 'calculated' && expiryDate ? ['Calculated from stated shelf life, not an exact date printed on package. Confirm the calculation.'] : [])
  ];
  if (expiryDate && dateOrigin === 'printed' && expiryEvidence?.confidence !== 'high') warnings.push('OCR support is limited; inspect the label closely.');
  if (conflictingLabels) warnings.push('OCR detected conflicting dates. Select the correct labelled date.');
  if (dateOrigin === 'qr_unverified' && expiryDate) warnings.push('QR codes are unverified; compare this date with the printed packaging.');
  const needsExplicitDateConfirmation = Boolean(expiryDate && (dateOrigin === 'printed' || dateOrigin === 'calculated' || dateOrigin === 'qr_unverified' || warnings.length > 0 || conflictingLabels));
  const activePhoto = photos.find(photo => photo.id === activePhotoId);
  const currentItem = { name, barcode, quantity, unit, expiry_date: expiryDate, date_type: dateType };
  const validation = validateScanItem(currentItem);

  async function applyItem(item) {
    if (submitLockRef.current) return;
    const checked = validateScanItem(item);
    if (!checked.valid) { setScanError(true); setScanMessage(checked.errors.join(' ')); return; }
    if (dateOrderInvalid) {
      setScanError(true); setScanMessage('Manufacturing date cannot be after expiry. Verify both printed dates.'); return;
    }
    if (dateTypeMissing) {
      setScanError(true); setScanMessage('Select expiry, use by, or best before before continuing.'); return;
    }
    if (needsExplicitDateConfirmation && !dateConfirmed) {
      setScanError(true); setScanMessage('Compare the date with the physical label and confirm before continuing.'); return;
    }
    if (typeof onApply !== 'function') {
      setScanError(true); setScanMessage('Pantry confirmation is not connected. No data has been saved.'); return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const normalized = toPantryBaseUnit(item);
      await onApply({
        name: item.name.trim(), barcode: item.barcode?.trim() || '',
        quantity: normalized.quantity, unit: normalized.unit,
        expiry_date: item.expiry_date || null,
        date_type: item.expiry_date ? item.date_type : 'unknown',
        date_source: item.expiry_date ? 'user_confirmed' : 'unknown'
      });
    } catch (error) {
      setScanError(true); setScanMessage(`Could not submit details: ${error.message || 'unknown error'}`);
    } finally {
      submitLockRef.current = false;
      if (activeRef.current) setSubmitting(false);
    }
  }

  const addScannedProductToList = () => {
    if (busy || submitting || (!name.trim() && !barcode.trim())) {
      setScanMessage('Scan a barcode or enter a product name first. An unidentified code may be added but will require review.');
      setScanError(true); return;
    }
    if (expiryDate && dateType === 'unknown') {
      setScanMessage('Select the printed expiry/use-by/best-before date type, or clear the date before adding.');
      setScanError(true); return;
    }
    if (dateOrderInvalid || (needsExplicitDateConfirmation && !dateConfirmed)) {
      setScanMessage('Verify the suspicious or inconsistent printed dates before adding this item.');
      setScanError(true); return;
    }
    const item = {
      id: `barcode-${++intakeSequenceRef.current}`,
      name: name.trim(), barcode: barcode.trim(), quantity, unit,
      expiry_date: expiryDate, date_type: expiryDate ? dateType : 'unknown',
      manufactured_date: manufacturedDate,
      labelCandidates: candidates.filter(candidate => candidate.type !== 'unknown'),
      labelText: ocrPreviewText, source: 'barcode', selected: true,
      raw: barcode ? `Barcode: ${barcode}` : 'Manually entered product'
    };
    const outcome = combineShoppingRows(receiptRows, [item]);
    setReceiptRows(outcome.rows);
    setScanError(false);
    setScanMessage(outcome.duplicates
      ? 'This barcode is already in your grocery list; no duplicate added. Edit its quantity in the final review if you bought multiple packs.'
      : outcome.merged
        ? 'Matched this product to a receipt item. Kept one row without double-counting. Scan the next product.'
        : 'Product added to the weekly list (not yet saved). Scan the next barcode or upload your bill.');
  };

  const updateRow = (index, key, value) => setReceiptRows(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const removeReceiptRow = id => setReceiptRows(rows => rows.filter(row => row.id !== id));
  const invalidReceiptRows = receiptRows.filter(row => !validateScanItem(row).valid);
  const submitReceipt = async () => {
    if (submitLockRef.current || !receiptRows.length) return;
    if (typeof onReceiptReview !== 'function') {
      setReceiptStatus('Bulk Pantry review is not connected. No items were saved.');
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      // Keep incomplete OCR rows in the SAME review screen so they can be fixed there.
      // No receipt quantities are guessed; the final save only sends valid rows.
      await onReceiptReview(prepareReceiptReviewItems(receiptRows));
    } catch (error) {
      setReceiptStatus(`Pantry review did not complete: ${error.message || 'unknown error'}`);
    } finally {
      submitLockRef.current = false;
      if (activeRef.current) setSubmitting(false);
    }
  };

  const sectionClass = 'rounded-2xl bg-[#f8faf7] p-4 shadow-sm';
  return (
    <div className="fixed inset-0 z-[800] flex flex-col bg-[#edf3ee] text-[#254b37]">
      <header className="flex shrink-0 items-center gap-3 bg-[#f8faf7] p-4 shadow-sm">
        <button type="button" aria-label="Close scanner" onClick={() => { stopCamera(); onClose?.(); }} className="min-h-11 min-w-11 rounded-xl focus:ring-2"><ArrowLeft size={24} /></button>
        <div><h1 className="text-lg font-extrabold">Scan & Review</h1><p className="text-xs text-[#819487]">Never auto-saves uncertain information</p></div>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-8">
        <div className="rounded-xl border border-[#c6dfcd] bg-white p-3 text-sm">
          <strong>One shopping list · {receiptRows.length} items</strong>
          <p className="mt-1 text-xs text-[#667f6d]">Scan a product barcode → name and listed pack size fill when available → Add to list → scan next. Or upload one bill. In the combined review, each item has its own date-photo camera and upload option.</p>
          {receiptRows.length > 0 && <button type="button" disabled={submitting || busy} onClick={submitReceipt} className={`${greenButton} mt-2`}>Review all {receiptRows.length} groceries together</button>}
        </div>
        <section className={sectionClass}>
          <h2 className="mb-2 flex items-center gap-2 font-bold"><Camera size={20} /> Photograph product dates</h2>
          <p className="mb-3 text-xs text-[#718b79]">Point the camera directly at the printed MFG / packed-on and EXP / use-by / best-before labels. Capture a sharp photo to read both dates automatically.</p>
          {cameraMode === 'photo' && <div className="relative mb-3 overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="block w-full" />
            <div aria-hidden="true" className="pointer-events-none absolute rounded-xl border-[3px] border-yellow-300 shadow-[0_0_0_100vmax_rgba(0,0,0,0.20)]" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }} />
            <p className="absolute bottom-2 left-2 right-2 rounded bg-black/60 px-2 py-1 text-center text-xs text-white">Hold steady · keep printed dates inside the frame</p>
          </div>}
          {cameraMode === 'photo' && cameraZoom && <label className="mb-3 block rounded-xl bg-[#eaf5ed] p-3 text-xs font-semibold">Camera zoom (if supported) · {Number(cameraZoom.value).toFixed(1)}×
            <input type="range" className="mt-2 w-full accent-[#287b50]" min={cameraZoom.min} max={cameraZoom.max} step={cameraZoom.step} value={cameraZoom.value} onChange={async event => {
              const value = Number(event.target.value);
              const track = zoomTrackRef.current;
              try {
                if (track?.readyState === 'live') await track.applyConstraints({ advanced: [{ zoom: value }] });
                setCameraZoom(old => old ? { ...old, value } : null);
              } catch { setScanMessage('Your camera does not support this zoom level. Use the crop controls after taking a photo.'); }
            }} />
          </label>}
          {activePhoto && cameraMode !== 'photo' && <div className="mb-3 grid grid-cols-2 gap-2"><div><p className="mb-1 text-xs font-semibold">Original photo + adjustable crop</p><div className="relative overflow-hidden rounded-xl bg-black"><img className="block w-full" src={activePhoto.url} alt="Captured product label; rectangle shows the region to re-read" /><div aria-hidden="true" className="pointer-events-none absolute border-[3px] border-yellow-300 shadow-[0_0_0_100vmax_rgba(0,0,0,0.20)]" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }} /></div></div><div><p className="mb-1 text-xs font-semibold">Last OCR crop (from this photo)</p><img className="w-full rounded-xl border bg-white object-contain" src={activePhoto.cropUrl} alt="Exact cropped region last analyzed for printed dates" /><p className="mt-1 text-[11px] text-[#718b79]">Move crop then tap Re-read to update</p></div></div>}
          <div className="mb-3 rounded-xl border border-[#d3e5d7] p-3 text-xs">
            <p className="font-semibold">Position the yellow OCR rectangle over all printed date text</p>
            <p className="mt-1 text-[#718b79]">Crop controls also zoom/enlarge the date area before OCR. Keep both MFG and EXP in the rectangle. Captured photos can be re-cropped.</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {[['width','Crop width / zoom',15,100],['height','Crop height',12,100],['x','Move left / right',0,100 - crop.width],['y','Move up / down',0,100 - crop.height]].map(([field,label,min,max]) => <label className="font-medium" key={field}>{label} · {Math.round(crop[field])}%<input className="mt-1 w-full accent-[#287b50]" aria-label={label} type="range" min={min} max={max} step="1" value={crop[field]} onChange={e => updateCropField(field,e.target.value)} /></label>)}
            </div>
            <button type="button" className="mt-2 rounded-lg border border-[#287b50] px-3 py-2 font-medium" onClick={() => setCrop({ ...DEFAULT_CROP })}>Reset to full image</button>
            {activePhoto && <button type="button" disabled={busy} className="ml-2 mt-2 rounded-lg bg-[#287b50] px-3 py-2 font-semibold text-white disabled:opacity-50" onClick={() => processOcrFile(activePhoto.file,false,activePhoto.id)}>Re-read this crop</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy || submitting} className={greenButton} onClick={() => {
              if (cameraMode === 'photo') stopCamera();
              else { setCameraMode('photo'); }
            }}><Camera size={18} className="mr-1 inline" />{cameraMode === 'photo' ? 'Close camera' : activePhoto ? 'Take another photo' : 'Open camera'}</button>
            <button type="button" disabled={busy || submitting} className="min-h-12 rounded-xl border-2 border-[#287b50] p-3 font-semibold disabled:opacity-50" onClick={() => setFacingMode(mode => mode === 'environment' ? 'user' : 'environment')}><RefreshCw size={18} className="mr-1 inline" />Flip camera</button>
          </div>
          {cameraMode === 'photo' && <button type="button" disabled={!cameraReady || busy || submitting} className={`${greenButton} mt-2`} onClick={captureLabelPhoto}><ScanLine size={18} className="mr-1 inline" />{cameraReady ? 'Capture & read dates' : 'Starting camera...'}</button>}
          <label className="mt-3 block cursor-pointer rounded-xl border-2 border-[#287b50] p-3 text-center font-semibold text-[#287b50]">Or upload a photo of the printed label
            <input className="sr-only" type="file" accept="image/*" disabled={busy || submitting} onChange={e => runOcr(e, false)} />
          </label>
          {ocrPreviewText && <details className="mt-3 rounded-xl bg-[#edf3ee] p-3 text-sm"><summary className="cursor-pointer font-semibold">Show text actually recognized from all photos</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{ocrPreviewText}</pre></details>}
          {dateScanStatus && <p className="mt-2 rounded-xl bg-[#fff3df] p-3 text-xs">{dateScanStatus}</p>}
          {ocrProgress && <p role="status" className="mt-2 rounded-lg bg-[#eaf5ed] p-2 text-xs">{ocrProgress}</p>}
          {photos.length > 0 && <div className="mt-3 rounded-xl border border-[#d3e5d7] p-3">
            <p className="text-sm font-semibold">Label photographs ({photos.length}/4) — tap to review, crop or remove</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{photos.map((photo,index) => <div className="rounded-lg border bg-white p-2" key={photo.id}>
              <button type="button" className={`block w-full rounded-lg p-1 text-left ${photo.id === activePhotoId ? 'ring-2 ring-[#287b50]' : ''}`} onClick={() => { setActivePhotoId(photo.id); setCrop({ ...photo.crop }); }}><img className="h-24 w-full rounded object-contain" src={photo.url} alt={`Label photograph ${index + 1}`} /><span className="text-xs">Photo {index + 1} · {photo.readings.length} OCR passes</span></button>
              <button type="button" disabled={busy} className="mt-1 min-h-10 text-xs font-semibold text-[#a34d39]" onClick={() => removePhoto(photo.id)}>Remove photo</button>
            </div>)}</div>
            <p className="mt-2 text-xs text-[#718b79]">Try one photo of the MFG/PKD label and another of EXP/Best Before. All photos are combined only for this review and discarded when you close the scanner.</p>
          </div>}
          {expiryEvidence && <div role="status" className="mt-3 rounded-xl bg-[#eaf5ed] p-3 text-sm"><strong>OCR evidence: {expiryEvidence.confidence.toUpperCase()}</strong><p className="mt-1 text-xs">{expiryEvidence.reason}. Read in {expiryEvidence.photoIds.length} photograph(s). High OCR agreement is not proof of correctness; check the package.</p></div>}
          {conflictingLabels && <p role="alert" className="mt-2 rounded-xl bg-[#fff3df] p-3 text-sm">Conflicting dates found. Choose the correct candidate below and confirm it. We will not guess which expiry is right.</p>}
          {manufactureCandidates.length > 0 && <div className="mt-3 space-y-2"><p className="text-sm font-semibold">Manufactured / packed on — tap to select</p>
            {manufactureCandidates.map((candidate, index) => <button key={`mfg-${candidate.date}-${index}`} type="button" className="block min-h-11 w-full rounded-xl bg-[#e6f0e7] p-3 text-left" onClick={() => {
              if (candidate.kind === 'packing') { setPackedDate(candidate.date); setPackedOrigin('manual'); }
              else { setManufacturedDate(candidate.date); setManufacturedOrigin('manual'); }
              setDateConfirmed(false);
              if (shelfLifeRules.length === 1 && candidates.every(row => row.type === 'unknown')) {
                const rule = shelfLifeRules[0];
                const sameOrigin = candidate.kind === rule.originKind || candidate.kind === 'both';
                const next = sameOrigin ? calculateShelfLifeDate(candidate.date, rule) : null;
                if (next) {
                  setExpiryDate(next); setDateType(rule.type);
                  setCalculatedDate({ date: next, type: rule.type, rule: rule.original, start_date: candidate.date });
                  setDateOrigin('calculated');
                } else if (dateOrigin === 'calculated') {
                  setExpiryDate(''); setDateType('unknown'); setCalculatedDate(null); setDateOrigin('');
                  setScanMessage('The printed rule starts from ' + rule.originKind + ', not the selected ' + candidate.kind + ' date. No expiry was inferred.');
                }
              }
            }}><CalendarDays size={15} className="mr-2 inline" />{candidate.date} · {candidate.kind || 'manufacturing/packing'} date (not expiry)</button>)}
          </div>}
          {candidates.length > 0 && <div className="mt-3 space-y-2"><p className="text-sm font-semibold">Expiry / use-by / best-before candidates — tap to select</p>
            {candidates.map((candidate, index) => <button key={`${candidate.date}-${index}`} className="block min-h-11 w-full rounded-xl bg-[#e6f0e7] p-3 text-left" onClick={() => { setExpiryDate(candidate.date); setDateType(candidate.type); setDateOrigin(candidate.type === 'unknown' ? 'manual' : 'printed'); setDateConfirmed(false); }} type="button"><CalendarDays size={15} className="mr-2 inline" />{candidate.date} · {candidate.type === 'unknown' ? 'unlabelled / uncertain: verify type' : candidate.type.replace('_', ' ')} · {candidate.confidence} OCR support</button>)}
          </div>}
          {shelfLifeRules.length > 0 && <div className="mt-3 rounded-xl border border-[#cce6d2] bg-[#eaf5ed] p-3 text-sm">
            <p className="font-semibold">Shelf-life wording detected</p>
            {shelfLifeRules.map((rule, index) => <p className="mt-1 break-words text-xs" key={`${rule.type}-${rule.amount}-${index}`}>{rule.original} {rule.type === 'unknown' ? '— date type unspecified, not automatically calculated.' : ''}</p>)}
            {calculatedDate && <p className="mt-2 font-semibold">Calculated {calculatedDate.type.replace('_', ' ')}: {calculatedDate.date} (from MFG/PKD {calculatedDate.start_date || manufacturedDate})</p>}
            <p className="mt-2 text-xs text-[#496c59]">Calculated dates are suggestions, not exact printed dates. Confirm against the actual packaging before saving.</p>
          </div>}
        </section>
        <section className={sectionClass}>
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Barcode size={20} /> Scan product barcode / QR</h2>
          <p className="mb-3 text-xs text-[#718b79]">Reads ONE code at a time. If the public database lists a package quantity, it fills automatically for verification. Expiry dates require a label photo.</p>
          {cameraMode === 'code' && <div className="relative mb-3 overflow-hidden rounded-xl bg-black"><video ref={videoRef} autoPlay muted playsInline className="aspect-[4/3] w-full object-cover" /><div aria-hidden="true" className="pointer-events-none absolute inset-[15%] rounded-xl border-[3px] border-white/80" /></div>}
          <button type="button" disabled={busy || submitting} className={greenButton} onClick={() => {
            if (cameraMode === 'code') stopCamera();
            else { scanGuardRef.current.reset(); setCameraMode('code'); }
          }}><Barcode size={18} className="mr-1 inline" />{cameraMode === 'code' ? 'Stop barcode scanner' : 'Scan barcode / QR'}</button>
          <label className="mt-3 block text-sm font-semibold">Manual barcode entry
            <input className={fieldClass} inputMode="numeric" placeholder="Enter printed barcode" value={barcode} onChange={e => manualCode(e.target.value)} />
          </label>
          <button className="mt-3 min-h-11 font-semibold text-[#287b50] disabled:opacity-50" disabled={busy || submitting} onClick={() => lookupProduct()} type="button"><Search size={17} className="mr-1 inline" />Look up product</button>
          {lookupStatus && <p className="mt-2 text-xs" role="status">{lookupStatus}</p>}
          <p className="mt-2 text-xs text-[#718b79]">Scan another product by tapping “Scan barcode / QR” again. A code can decode successfully even when the product database has no entry. If a code will not decode, move closer, improve lighting, or type the printed digits above.</p>
        </section>
        <section className={sectionClass}>
          <h2 className="mb-2 font-bold">Review scanned product</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm font-semibold">Product name<input className={fieldClass} value={name} onChange={e => setName(e.target.value)} placeholder="Printed product name" /></label>
            <label className="text-sm font-semibold">Quantity<input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 500" /></label>
            <label className="text-sm font-semibold">Unit<select className={fieldClass} value={unit} onChange={e => setUnit(e.target.value)}><option value="">Select</option>{['g','kg','ml','l','pcs'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="text-sm font-semibold">Date type<select className={fieldClass} value={dateType} onChange={e => { setDateType(e.target.value); setDateConfirmed(false); }}><option value="unknown">Not specified</option><option value="expiry">Expiry</option><option value="use_by">Use by</option><option value="best_before">Best before</option></select></label>
            <label className="text-sm font-semibold">Manufacturing (MFG) date<input className={fieldClass} type="date" value={manufacturedDate} onChange={e => {
              const nextDate = e.target.value;
              setManufacturedDate(nextDate); setManufacturedOrigin('manual'); setDateConfirmed(false);
              if (shelfLifeRules.length === 1 && dateOrigin === 'calculated' && shelfLifeRules[0].originKind === 'manufacture') {
                const next = calculateShelfLifeDate(nextDate, shelfLifeRules[0]);
                setExpiryDate(next || '');
                setCalculatedDate(next ? { date: next, type: shelfLifeRules[0].type, rule: shelfLifeRules[0].original, start_date: nextDate } : null);
              }
            }} /></label>
            <label className="text-sm font-semibold">Packed-on (PKD) date<input className={fieldClass} type="date" value={packedDate} onChange={e => {
              const nextDate = e.target.value;
              setPackedDate(nextDate); setPackedOrigin('manual'); setDateConfirmed(false);
              if (shelfLifeRules.length === 1 && dateOrigin === 'calculated' && shelfLifeRules[0].originKind === 'packing') {
                const next = calculateShelfLifeDate(nextDate, shelfLifeRules[0]);
                setExpiryDate(next || '');
                setCalculatedDate(next ? { date: next, type: shelfLifeRules[0].type, rule: shelfLifeRules[0].original, start_date: nextDate } : null);
              }
            }} /></label>
            <label className="text-sm font-semibold">Expiry / use-by / best-before date<input className={fieldClass} type="date" value={expiryDate} onChange={e => { setExpiryDate(e.target.value); setDateOrigin('manual'); setDateConfirmed(false); }} /></label>
          </div>
          <p className="mt-3 text-xs text-[#718b79]">A clear printed expiry fills automatically. If only MFG/PKD plus a stated shelf life is printed, the calculated expiry can fill automatically, but ALWAYS requires confirmation. Unknown or ambiguous dates remain blank. MFG/PKD is for review only and is never stored as expiry.</p>
          {dateOrigin === 'calculated' && expiryDate && <p role="status" className="mt-2 rounded-lg bg-[#fff3df] p-2 text-xs font-semibold text-[#815b26]">Calculated from printed shelf life — NOT an exact date copied from the package.</p>}
          {dateTypeMissing && <p className="mt-2 text-xs text-[#a65a42]">Choose the correct date type for the selected date.</p>}
          {needsExplicitDateConfirmation && <div className="mt-3 rounded-xl bg-[#fff3df] p-3 text-xs"><AlertTriangle size={16} className="mr-1 inline" />{warnings.join(' ')}<label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={dateConfirmed} onChange={e => setDateConfirmed(e.target.checked)} />I compared the selected date with the printed package (or confirmed the stated shelf-life calculation).</label></div>}
          {!validation.valid && <p className="mt-2 text-xs text-[#a65a42]">{validation.errors.join(' ')}</p>}
          <button type="button" className={`${greenButton} mt-4`} disabled={busy || submitting || dateOrderInvalid || dateTypeMissing || (needsExplicitDateConfirmation && !dateConfirmed)} onClick={addScannedProductToList}><CheckCircle2 size={18} className="mr-1 inline" />Add product to weekly grocery list</button>
          <p className="mt-2 text-xs text-[#718b79]">Unknown name, quantity or date stays blank for correction in the combined review. Barcode lookup cannot reliably supply a particular package's expiry.</p>
          <button type="button" className="mt-2 min-h-11 w-full rounded-xl border border-[#287b50] bg-white p-3 text-sm font-semibold text-[#287b50] disabled:opacity-50" disabled={busy || submitting || !validation.valid || dateOrderInvalid || dateTypeMissing || (needsExplicitDateConfirmation && !dateConfirmed)} onClick={() => applyItem(currentItem)}>{submitting ? 'Preparing...' : 'Use this product alone (instead of weekly list)'}</button>
        </section>
        <section className={sectionClass}>
          <h2 className="mb-2 font-bold">Grocery bill OCR (multiple items)</h2>
          <p className="mb-3 text-xs text-[#718b79]">Receipt prices are not quantities. Transaction dates are not expiry dates. Correct every item before Pantry review.</p>
          <label className={`${greenButton} block cursor-pointer text-center`}>{busy ? 'Processing receipt...' : 'Take photo / upload receipt'}
            <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy} onChange={e => runOcr(e, true)} />
          </label>
          {receiptStatus && <p role="status" className="mt-2 text-sm">{receiptStatus}</p>}
          {receiptRows.length > 0 && (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-semibold">{receiptRows.length} grocery item(s) queued from barcode scans and/or receipt OCR. All go to one combined review.</p>
              {receiptRows.map((item, i) => (
                <div key={item.id} className="rounded-xl border border-[#cce6d2] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">Item {i + 1}</strong>
                    <button type="button" className="min-h-10 rounded-lg px-3 text-xs font-semibold text-[#9b4937]" onClick={() => removeReceiptRow(item.id)}>Remove incorrect item</button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="col-span-2 text-xs">Name<input className={fieldClass} value={item.name} onChange={e => updateRow(i, 'name', e.target.value)} /></label>
                    <label className="text-xs">Quantity<input type="number" min="0" step="any" className={fieldClass} value={item.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} /></label>
                    <label className="text-xs">Unit<select className={fieldClass} value={item.unit} onChange={e => updateRow(i, 'unit', e.target.value)}><option value="">Select</option>{['g','kg','ml','l','pcs'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                  </div>
                  <p className="mt-2 text-[11px] text-[#718b79]">OCR: {item.raw}</p>
                  {!validateScanItem(item).valid && <p className="mt-2 text-xs font-semibold text-[#a65a42]">Needs correction: {validateScanItem(item).errors.join(' ')}</p>}
                </div>
              ))}
              {invalidReceiptRows.length > 0 && <p className="rounded-xl bg-[#fff3df] p-3 text-xs text-[#815b26]">{invalidReceiptRows.length} item(s) need more information. You can correct them in the combined review; valid items will not be held back.</p>}
              <button type="button" className={greenButton} disabled={submitting || busy || receiptRows.length === 0} onClick={submitReceipt}>
                {submitting ? 'Opening review...' : `Review all ${receiptRows.length} items together`}
              </button>
            </div>
          )}
        </section>
        <div className={`rounded-xl p-3 text-sm ${scanError ? 'bg-[#fff3df] text-[#815b26]' : 'bg-[#dff0e2] text-[#287b50]'}`} role="status" aria-live="polite">{busy && <LoaderCircle size={15} className="mr-2 inline animate-spin" />}{scanMessage}</div>
      </div>
      <footer className="shrink-0 bg-[#f8faf7] px-4 py-3 text-center text-xs text-[#718b79] shadow-lg">Nothing is saved until the Pantry confirmation flow is completed.</footer>
    </div>
  );
}
