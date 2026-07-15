export async function imageToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvasContext(canvas).drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

export async function exportCanvas(canvas, type = "image/png", quality = 0.85) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("This browser cannot export that image format.");
  return blob;
}

export async function imageDimensions(file) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dimensions;
}

export async function cleanImageMetadata(file, type = file.type || "image/png", quality = 0.92) {
  const canvas = await imageToCanvas(file);
  return exportCanvas(canvas, type, quality);
}

export async function compressImage(file, type, quality) {
  const canvas = await imageToCanvas(file);
  return exportCanvas(canvas, type, quality);
}

export async function resizeImage(file, width, height, preserveAspect) {
  const source = await imageToCanvas(file);
  const ratio = source.width / source.height;
  let nextWidth = optionalPositiveNumber(width, "Width");
  let nextHeight = optionalPositiveNumber(height, "Height");
  if (!nextWidth && !nextHeight) throw new Error("Enter a valid width or height.");
  if (preserveAspect) {
    if (nextWidth) nextHeight = Math.max(1, Math.round(nextWidth / ratio));
    else nextWidth = Math.max(1, Math.round(nextHeight * ratio));
  } else if (!nextWidth || !nextHeight) {
    throw new Error("Enter both width and height when aspect ratio is not preserved.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvasContext(canvas).drawImage(source, 0, 0, nextWidth, nextHeight);
  return canvas;
}

export async function cropImage(file, x, y, width, height) {
  const source = await imageToCanvas(file);
  const cropX = clamp(nonNegativeNumber(x, "X coordinate"), 0, source.width - 1);
  const cropY = clamp(nonNegativeNumber(y, "Y coordinate"), 0, source.height - 1);
  const cropWidth = clamp(positiveNumber(width, "Crop width"), 1, source.width - cropX);
  const cropHeight = clamp(positiveNumber(height, "Crop height"), 1, source.height - cropY);
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  canvasContext(canvas).drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas;
}

export async function rotateFlipImage(file, rotation, flipX, flipY) {
  const source = await imageToCanvas(file);
  const angle = finiteNumber(rotation, "Rotation");
  const radians = (angle * Math.PI) / 180;
  const swap = Math.abs(angle) % 180 === 90;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const context = canvasContext(canvas);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

export async function addTextToImage(file, options = {}) {
  const canvas = await imageToCanvas(file);
  const context = canvasContext(canvas);
  const text = String(options.text || "").trim();
  if (!text) throw new Error("Enter text to add.");
  const size = positiveNumber(options.size ?? 48, "Text size");
  context.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  context.fillStyle = String(options.color || "#111827");
  context.strokeStyle = String(options.outline || "rgba(255,255,255,.78)");
  context.lineWidth = Math.max(2, size * 0.08);
  const x = finiteNumber(options.x ?? 40, "X coordinate");
  const y = finiteNumber(options.y ?? Math.min(canvas.height - 40, 80), "Y coordinate");
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
  return canvas;
}

export async function addSignatureToImage(imageFile, signatureFile, options = {}) {
  const canvas = await imageToCanvas(imageFile);
  const signature = await imageToCanvas(signatureFile);
  const context = canvasContext(canvas);
  const width = positiveNumber(options.width ?? Math.min(280, canvas.width * 0.36), "Signature width");
  const height = Math.max(1, width * (signature.height / signature.width));
  context.globalAlpha = clamp(finiteNumber(options.opacity ?? 1, "Opacity"), 0.1, 1);
  context.drawImage(
    signature,
    finiteNumber(options.x ?? 40, "X coordinate"),
    finiteNumber(options.y ?? canvas.height - height - 40, "Y coordinate"),
    width,
    height
  );
  context.globalAlpha = 1;
  return canvas;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function canvasContext(canvas) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D image workspace.");
  return context;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function optionalPositiveNumber(value, label) {
  if (value === "" || value === null || value === undefined) return 0;
  return positiveNumber(value, label);
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} cannot be negative.`);
  return number;
}
