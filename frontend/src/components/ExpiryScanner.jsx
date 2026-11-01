import AuditStock from "./AuditStock.jsx";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { createWorker } from "tesseract.js";
import {
  ArrowLeft,
  Barcode,
  Camera,
  CheckCircle2,
  CalendarDays,
  Search,
  ScanLine,
  LoaderCircle,
  AlertTriangle
} from "lucide-react";

// Convert OCR date text into YYYY-MM-DD.
// Numeric dates are interpreted as DD/MM/YYYY.
function normalizeDate(text) {
  const value = text.trim();
  let day, month, year;

  let match = value.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
  );

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = value.match(
      /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/
    );

    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = value.match(
        /^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s,/-]+(\d{2,4})$/
      );

      if (!match) return null;

      const months = [
        "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
        "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
      ];

      day = Number(match[1]);
      month = months.indexOf(
        match[2].slice(0, 3).toUpperCase()
      ) + 1;
      year = Number(match[3]);
    }
  }

  if (year < 100) {
    year += 2000;
  }

  const checked = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() + 1 !== month ||
    checked.getUTCDate() !== day
  ) {
    return null;
  }

  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

const DATE_PATTERN =
  /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[\s/-]+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,/-]+\d{2,4})\b/gi;

function detectDateType(text) {
  if (/\bBEST\s*BEFORE\b|\bBBE\b/i.test(text)) {
    return "best_before";
  }

  if (/\bUSE\s*BY\b/i.test(text)) {
    return "use_by";
  }

  if (/\bEXP(?:IRY|IRATION)?\b/i.test(text)) {
    return "expiry";
  }

  return "unknown";
}

function extractDates(text) {
  const lines = text.split(/\r?\n/);
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const dateType = detectDateType(line);

    // Skip manufacturing dates unless expiry is also
    // explicitly written on the same line.
    if (
      /\b(MFG|MFD|MANUFACTURED|PACKED ON)\b/i.test(line) &&
      dateType === "unknown"
    ) {
      continue;
    }

    // A label may be on the preceding line.
    const previousType =
      i > 0 ? detectDateType(lines[i - 1]) : "unknown";

    const type =
      dateType !== "unknown" ? dateType : previousType;

    const matches = line.match(DATE_PATTERN) || [];

    for (const found of matches) {
      const date = normalizeDate(found);

      if (!date) continue;

      if (!results.some(item =>
        item.date === date && item.type === type
      )) {
        results.push({
          date,
          type,
          original: found
        });
      }
    }
  }

  return results;
}

export default function ExpiryScanner({
  onClose,
  onApply
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [barcode, setBarcode] = useState("");
  const [productName, setProductName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [dateType, setDateType] = useState("expiry");
  const [dates, setDates] = useState([]);
  const [message, setMessage] = useState("");

  const videoRef = useRef(null);

  // Barcode camera
  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;
    let controls = null;

    const reader = new BrowserMultiFormatReader();

    async function startCamera() {
      try {
        const scannerControls =
          await reader.decodeFromConstraints(
            {
              audio: false,
              video: {
                facingMode: { ideal: "environment" }
              }
            },
            videoRef.current,
            (result, error, liveControls) => {
              if (cancelled || !result) return;

              const detected = result.getText().trim();

              setBarcode(detected);
              setMessage(
                `Code detected: ${detected}. Look up the product or confirm the details.`
              );

              liveControls.stop();
              setCameraOpen(false);
            }
          );

        if (cancelled) {
          scannerControls.stop();
        } else {
          controls = scannerControls;
        }
      } catch (error) {
        if (cancelled) return;

        setMessage(
          "Unable to access the camera. Check permissions or use manual entry. " +
          error.message
        );

        setCameraOpen(false);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [cameraOpen]);

  // OCR for printed expiry labels
  async function scanExpiryImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage("Reading text from the image...");
    setDates([]);

    let worker = null;

    try {
      worker = await createWorker("eng");

      const result = await worker.recognize(file);
      const detected = extractDates(
        result.data.text || ""
      );

      setDates(detected);

      // Only prefill a date if one labelled candidate
      // was detected. User still must confirm it.
      if (
        detected.length === 1 &&
        detected[0].type !== "unknown"
      ) {
        setExpiryDate(detected[0].date);
        setDateType(detected[0].type);
      }

      setMessage(
        detected.length > 0
          ? `Found ${detected.length} possible date(s). Verify the printed date before continuing.`
          : "No clear date found. Enter it manually."
      );
    } catch (error) {
      setMessage(
        "Could not read the image: " + error.message
      );
    } finally {
      if (worker) await worker.terminate();

      setLoading(false);
      event.target.value = "";
    }
  }

  // Optional product lookup by retail barcode
  async function lookupProduct() {
    const code = barcode.trim();

    if (!/^\d{8,14}$/.test(code)) {
      setMessage(
        "Enter a numeric product barcode (8–14 digits). QR links cannot be looked up as product barcodes."
      );
      return;
    }

    setLoading(true);
    setMessage("Looking up the product...");

    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,brands`
      );

      if (!response.ok) {
        throw new Error("Lookup unavailable");
      }

      const data = await response.json();

      if (data.status === 1 && data.product) {
        setProductName(
          data.product.product_name ||
          data.product.brands ||
          ""
        );

        setMessage(
          "Product found. Confirm its details and scan the printed expiry label."
        );
      } else {
        setMessage(
          "Product not found. Enter its name manually."
        );
      }
    } catch {
      setMessage(
        "Online product lookup failed. Enter the product name manually."
      );
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (!productName.trim()) {
      setMessage("Please enter the product name.");
      return;
    }

    if (!expiryDate) {
      setMessage(
        "Please scan or enter the printed expiry/best-before date."
      );
      return;
    }

    if (!onApply) {
      setMessage(
        "The Pantry confirmation handler is not connected."
      );
      return;
    }

    onApply({
      name: productName.trim(),
      barcode: barcode.trim(),
      expiry_date: expiryDate,
      date_type: dateType,
      date_source: "user_confirmed"
    });
  }

  return (
    <div className="ks-expiry-scanner fixed inset-0 z-[800] flex flex-col bg-[#edf3ee] text-[#254b37]">

      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 bg-[#f8faf7] p-4 shadow-sm">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <ArrowLeft size={24} />
        </button>

        <div>
          <h1 className="text-lg font-extrabold">
            Scan Ingredient
          </h1>
          <p className="text-xs text-[#819487]">
            Barcode + Expiry Detection
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-8">

        {/* BARCODE SCANNER */}
        <section className="rounded-2xl bg-[#f8faf7] p-4 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 font-bold">
            <Barcode size={20} className="text-[#287b50]" />
            Barcode / QR Scanner
          </h2>

          {cameraOpen && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="mb-3 w-full rounded-xl bg-black"
            />
          )}

          <button
            type="button"
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#287b50] p-3 font-bold text-white"
            onClick={() => setCameraOpen(!cameraOpen)}
          >
            <ScanLine size={19} />
            {cameraOpen
              ? "Stop Camera"
              : "Scan Barcode with Camera"}
          </button>

          <input
            type="text"
            placeholder="Or enter barcode manually"
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            className="mb-3 w-full rounded-xl bg-[#e9f2ea] p-3 outline-none"
          />

          <button
            type="button"
            disabled={loading}
            onClick={lookupProduct}
            className="flex items-center gap-2 font-semibold text-[#287b50] disabled:opacity-50"
          >
            <Search size={17} />
            Look Up Product
          </button>
        </section>

        {/* EXPIRY OCR */}
        <section className="rounded-2xl bg-[#f8faf7] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-bold">
            <Camera size={20} className="text-[#287b50]" />
            Scan Expiry Label
          </h2>

          <p className="mb-3 text-xs leading-relaxed text-[#819487]">
            Take a clear picture of the printed expiry,
            use-by, or best-before date.
          </p>

          <label className="block cursor-pointer rounded-xl bg-[#287b50] p-3 text-center font-bold text-white">
            <Camera
              size={18}
              className="mr-2 inline-block"
            />
            {loading
              ? "Processing image..."
              : "Take Photo / Upload Image"}

            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={loading}
              onChange={scanExpiryImage}
              className="hidden"
            />
          </label>

          {dates.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-bold">
                Possible dates found:
              </p>

              {dates.map((item, index) => (
                <button
                  type="button"
                  key={`${item.date}-${index}`}
                  onClick={() => {
                    setExpiryDate(item.date);

                    if (item.type !== "unknown") {
                      setDateType(item.type);
                    }
                  }}
                  className="w-full rounded-xl bg-[#e6f0e7] p-3 text-left"
                >
                  <CalendarDays
                    size={16}
                    className="mr-2 inline-block text-[#287b50]"
                  />
                  <span className="font-bold">
                    {item.date}
                  </span>
                  <span className="ml-2 text-xs text-[#718b79]">
                    {item.type.replace("_", " ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* CONFIRMATION FORM */}
        <section className="space-y-4 rounded-2xl bg-[#f8faf7] p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold">
            <CheckCircle2
              size={20}
              className="text-[#287b50]"
            />
            Confirm Details
          </h2>

          <label className="block text-sm font-semibold">
            Product Name
            <input
              type="text"
              value={productName}
              onChange={e =>
                setProductName(e.target.value)
              }
              placeholder="e.g. Amul Paneer"
              className="mt-2 w-full rounded-xl bg-[#e9f2ea] p-3 font-normal outline-none"
            />
          </label>

          <label className="block text-sm font-semibold">
            Date Type
            <select
              value={dateType}
              onChange={e => setDateType(e.target.value)}
              className="mt-2 w-full rounded-xl bg-[#e9f2ea] p-3"
            >
              <option value="expiry">Expiry</option>
              <option value="use_by">Use By</option>
              <option value="best_before">
                Best Before
              </option>
            </select>
          </label>

          <label className="block text-sm font-semibold">
            Printed Date
            <input
              type="date"
              value={expiryDate}
              onChange={e =>
                setExpiryDate(e.target.value)
              }
              className="mt-2 w-full rounded-xl bg-[#e9f2ea] p-3"
            />
          </label>

          <div className="flex items-start gap-2 rounded-xl bg-[#fff3df] p-3 text-xs text-[#987038]">
            <AlertTriangle
              size={17}
              className="shrink-0"
            />
            Verify the date against the package.
            OCR can misread dates or confuse
            manufacturing and expiry information.
          </div>
        </section>

        {message && (
          <div
            role="status"
            className="rounded-xl bg-[#dff0e2] p-3 text-sm text-[#287b50]"
          >
            {message}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="shrink-0 bg-[#f8faf7] p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-lg">
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#287b50] font-extrabold text-white disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle
              size={19}
              className="animate-spin"
            />
          ) : (
            <CheckCircle2 size={19} />
          )}
          Use Confirmed Information
        </button>
      </footer>
    </div>
  );
}
