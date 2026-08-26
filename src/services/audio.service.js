// Browser speech helpers (Phase 4b) for PDF to Audio and Audio to PDF.
//
// Both directions use the engines already built into the browser — no npm audio
// library, no model download, no network call from this app:
//   * Text to speech: window.speechSynthesis. The voices are the operating
//     system's, and playback is local. There is deliberately NO export: the Web
//     Speech API gives no access to the rendered audio samples, and this app
//     ships no audio encoder, so "save as MP3" is not something we can honestly
//     offer offline.
//   * Speech to text: window.SpeechRecognition / webkitSpeechRecognition. This
//     is the one place in MyFileKit where the browser itself may send audio to
//     its vendor: Chrome's default engine is cloud-backed. The recognizer below
//     therefore asks for the on-device mode by default (which makes the browser
//     error out rather than stream audio anywhere), the UI states plainly what
//     the current browser will do, and the manual-transcript path stays fully
//     offline.

// --- Text to speech ----------------------------------------------------------

export function speechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

export function getSpeechSynthesis() {
  if (!speechSynthesisSupported()) {
    throw new Error("This browser has no built-in speech engine, so text cannot be read aloud here.");
  }
  return window.speechSynthesis;
}

/**
 * Voices populate asynchronously in most browsers, so wait briefly for the
 * `voiceschanged` event before giving up.
 */
export async function loadSpeechVoices({ timeout = 2000 } = {}) {
  const synthesis = getSpeechSynthesis();
  const immediate = synthesis.getVoices();
  if (immediate.length) return immediate;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synthesis.removeEventListener?.("voiceschanged", finish);
      clearTimeout(timer);
      resolve(synthesis.getVoices());
    };
    const timer = setTimeout(finish, timeout);
    synthesis.addEventListener?.("voiceschanged", finish);
  });
}

/**
 * Splits text into utterance-sized chunks on sentence boundaries. Long single
 * utterances are truncated or dropped by several engines, and chunking also
 * gives the UI a real progress signal. Pure — unit-testable in Node.
 */
export function splitTextForSpeech(text, maxLength = 220) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  const sentences = value.match(/[^.!?]+[.!?]*\s*/g) || [value];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    for (const piece of splitLongPiece(sentence.trim(), maxLength)) {
      if (!current) {
        current = piece;
      } else if (`${current} ${piece}`.length <= maxLength) {
        current = `${current} ${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// A sentence longer than the limit is broken on word boundaries, and a single
// word longer than the limit is hard-split. Nothing is ever dropped.
function splitLongPiece(piece, maxLength) {
  if (!piece) return [];
  if (piece.length <= maxLength) return [piece];
  const parts = [];
  let current = "";
  for (const word of piece.split(" ")) {
    for (const fragment of hardSplit(word, maxLength)) {
      if (!current) current = fragment;
      else if (`${current} ${fragment}`.length <= maxLength) current = `${current} ${fragment}`;
      else {
        parts.push(current);
        current = fragment;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

function hardSplit(word, maxLength) {
  if (word.length <= maxLength) return [word];
  const parts = [];
  for (let index = 0; index < word.length; index += maxLength) parts.push(word.slice(index, index + maxLength));
  return parts;
}

// --- Speech to text ----------------------------------------------------------

/**
 * Feature-detects the recognition engine, synchronously. `canRunOnDevice` is
 * true only when the browser exposes the on-device mode; without it the engine
 * is cloud-backed and the caller must say so.
 *
 * Deliberately does NOT call `SpeechRecognition.available()`: that experimental
 * probe can hang (it wedged the renderer outright in one Chromium build), and
 * `processLocally = true` already makes the browser fail loudly rather than
 * quietly fall back to the cloud, which is the answer we actually want.
 */
export function speechRecognitionSupport() {
  if (typeof window === "undefined") return { supported: false, canRunOnDevice: false, ctor: null };
  const ctor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  if (!ctor) return { supported: false, canRunOnDevice: false, ctor: null };
  return { supported: true, canRunOnDevice: "processLocally" in (ctor.prototype || {}), ctor };
}

/**
 * Creates a continuous recognizer. The caller owns the returned object and MUST
 * call `stop()` on unmount so the microphone indicator goes away.
 *
 * With `requireOnDevice` the recognizer asks the browser to keep audio on the
 * machine; browsers that honour the flag then error out instead of streaming to
 * a server, so this is the privacy-preserving default.
 *
 * @param {{ lang?: string, requireOnDevice?: boolean, onTranscript?: (result: { final: string, interim: string }) => void, onError?: (message: string) => void, onEnd?: () => void }} [options]
 */
export async function createSpeechRecognizer({ lang = "en-US", requireOnDevice = true, onTranscript, onError, onEnd } = {}) {
  const { supported, canRunOnDevice, ctor } = speechRecognitionSupport();
  if (!supported) {
    throw new Error("This browser has no built-in speech recognition. Paste or type the transcript instead — that path is fully offline.");
  }
  if (requireOnDevice && !canRunOnDevice) {
    throw new Error("This browser cannot keep speech recognition on your device. Either allow cloud recognition with the checkbox, or paste the transcript instead — that path is fully offline.");
  }
  const recognition = new ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;

  let local = false;
  if (requireOnDevice) {
    try {
      recognition.processLocally = true;
      local = true;
    } catch {
      throw new Error("This browser refused to keep speech recognition on your device. Paste the transcript instead — that path is fully offline.");
    }
  }

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) finalText += transcript;
      else interimText += transcript;
    }
    onTranscript?.({ final: finalText, interim: interimText });
  };
  recognition.onerror = (event) => onError?.(recognitionErrorMessage(event?.error));
  recognition.onend = () => onEnd?.();

  return {
    local,
    start: () => recognition.start(),
    stop: () => {
      try {
        recognition.onend = null;
        recognition.stop();
        recognition.abort?.();
      } catch {
        // Already stopped.
      }
    },
  };
}

function recognitionErrorMessage(code) {
  if (code === "not-allowed" || code === "service-not-allowed") return "Microphone access was blocked. Allow it in your browser, or paste the transcript instead.";
  if (code === "no-speech") return "No speech was detected. Try again, or paste the transcript instead.";
  if (code === "audio-capture") return "No microphone was found.";
  if (code === "network") return "The browser's speech engine could not be reached. Paste the transcript instead — that path is fully offline.";
  if (code === "language-not-supported") return "This browser has no on-device model for this language. Either allow cloud recognition with the checkbox, or paste the transcript instead.";
  return `Speech recognition stopped: ${code || "unknown error"}.`;
}
