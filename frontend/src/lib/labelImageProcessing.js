/** Local image preparation for OCR. Image pixels never leave the browser. */
export const DEFAULT_CROP = Object.freeze({ x: 0, y: 0, width: 100, height: 100 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

// Percent controls describe the same image rectangle for camera photos and uploads.
export function normalizeCrop(crop = DEFAULT_CROP) {
  const width = clamp(crop.width ?? 100, 15, 100);
  const height = clamp(crop.height ?? 100, 12, 100);
  return {
    x: clamp(crop.x ?? 0, 0, 100 - width),
    y: clamp(crop.y ?? 0, 0, 100 - height),
    width,
    height
  };
}

export function computeCropRect(pixelWidth, pixelHeight, crop = DEFAULT_CROP) {
  if (!(pixelWidth > 0 && pixelHeight > 0)) throw new Error('Image dimensions are not available.');
  const c = normalizeCrop(crop);
  const sx = Math.min(pixelWidth - 1, Math.floor(pixelWidth * c.x / 100));
  const sy = Math.min(pixelHeight - 1, Math.floor(pixelHeight * c.y / 100));
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(pixelWidth - sx, Math.ceil(pixelWidth * c.width / 100))),
    sh: Math.max(1, Math.min(pixelHeight - sy, Math.ceil(pixelHeight * c.height / 100)))
  };
}

export const OCR_PASSES = Object.freeze([
  { name: 'original', scale: 1, contrast: 'color' },
  { name: 'enlarged-gray', scale: 1.8, contrast: 'gray' },
  { name: 'high-contrast', scale: 1.8, contrast: 'threshold' }
]);

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  // Browsers without createImageBitmap may still support regular image upload.
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = url;
    await new Promise((resolve, reject) => { element.onload = resolve; element.onerror = () => reject(new Error('Image could not be opened.')); });
    return { image: element, width: element.naturalWidth, height: element.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function transformPixels(imageData, mode) {
  const data = imageData.data;
  if (mode === 'color') return;
  // Print is often dark text on a bright package. Preserve natural image for one pass.
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = mode === 'threshold'
      ? (gray > 145 ? 255 : 0)
      : Math.max(0, Math.min(255, (gray - 125) * 1.45 + 130));
    data[i] = data[i + 1] = data[i + 2] = value;
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image processing failed.')), 'image/png'));
}

/** Returns close-up variants; memory bounded by a maximum 2200px edge. */
export async function prepareLabelOcrVariants(file, crop = DEFAULT_CROP) {
  const input = await loadImage(file);
  try {
    const { sx, sy, sw, sh } = computeCropRect(input.width, input.height, crop);
    const outputs = [];
    for (const pass of OCR_PASSES) {
      const factor = Math.min(pass.scale, 2200 / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * factor));
      canvas.height = Math.max(1, Math.round(sh * factor));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas processing is unavailable.');
      context.imageSmoothingEnabled = true;
      context.drawImage(input.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      if (pass.contrast !== 'color') {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        transformPixels(pixels, pass.contrast);
        context.putImageData(pixels, 0, 0);
      }
      outputs.push({ name: pass.name, image: await canvasBlob(canvas) });
    }
    return outputs;
  } finally { input.close(); }
}
