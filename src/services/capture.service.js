// Browser-only helpers for the camera (Scan to PDF) and document enhancement
// (Handwriting/Scan). Every function touches the DOM/media APIs, so nothing here
// runs at import time — keeping this module import-safe for Node tests.

export function getHtml2Canvas() {
  const engine = window.html2canvas;
  if (typeof engine !== "function") throw new Error("Local render engine failed to load. Reload the page and try again.");
  return engine;
}

export async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser has no camera access. Try a device with a camera, or use Handwriting to PDF to upload photos instead.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error("Camera permission was denied. Allow camera access in your browser, then try again.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
      throw new Error("No camera was found on this device. Use Handwriting to PDF to upload photos instead.");
    }
    if (name === "NotReadableError") {
      throw new Error("The camera is already in use by another app. Close it and try again.");
    }
    throw new Error("Could not start the camera. Check your device and browser permissions.");
  }
}

export function stopCameraStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Ignore tracks that are already stopped.
    }
  });
}

export function captureVideoFrame(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("The camera is not ready yet. Wait for the preview, then capture.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D image workspace.");
  context.drawImage(video, 0, 0, width, height);
  return canvas;
}

// "Document" enhancement: optional grayscale + contrast stretch to make scanned
// or photographed handwriting cleaner. Returns the same canvas, mutated in place.
export function enhanceCanvas(canvas, { grayscale = true, contrast = 40 } = {}) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D image workspace.");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  // Standard contrast curve; contrast is a -100..100 style amount.
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }
    data[i] = clampByte(factor * (r - 128) + 128);
    data[i + 1] = clampByte(factor * (g - 128) + 128);
    data[i + 2] = clampByte(factor * (b - 128) + 128);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function clampByte(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
