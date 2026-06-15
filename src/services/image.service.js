export async function imageToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
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
  let nextWidth = Math.max(1, Number(width));
  let nextHeight = Math.max(1, Number(height));
  if (preserveAspect) {
    if (width && !height) nextHeight = Math.round(nextWidth / ratio);
    else if (height && !width) nextWidth = Math.round(nextHeight * ratio);
    else nextHeight = Math.round(nextWidth / ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.getContext("2d").drawImage(source, 0, 0, nextWidth, nextHeight);
  return canvas;
}

export async function cropImage(file, x, y, width, height) {
  const source = await imageToCanvas(file);
  const cropX = clamp(Number(x), 0, source.width - 1);
  const cropY = clamp(Number(y), 0, source.height - 1);
  const cropWidth = clamp(Number(width), 1, source.width - cropX);
  const cropHeight = clamp(Number(height), 1, source.height - cropY);
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  canvas.getContext("2d").drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return canvas;
}

export async function rotateFlipImage(file, rotation, flipX, flipY) {
  const source = await imageToCanvas(file);
  const radians = (Number(rotation) * Math.PI) / 180;
  const swap = Math.abs(Number(rotation)) % 180 === 90;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? source.height : source.width;
  canvas.height = swap ? source.width : source.height;
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
