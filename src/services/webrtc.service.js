// Manual-signaling WebRTC transport for MyFileKit.
//
// MyFileKit has no backend and pins `connect-src 'self'`, so there is no
// signaling server to lean on. Instead the two peers exchange one short text
// code each, through whatever channel they already trust (chat, email, a shared
// note). Everything in the top half of this file is pure: no DOM, no RTC, no
// network — so the framing, encoding, hashing, and sanitising logic is unit
// testable in Node. The browser-only half (createPeerLink, sendFileOverLink)
// is at the bottom and is never touched at import time.
//
// Codes carry the full local description *including* ICE candidates ("vanilla
// ICE"), because there is no channel to trickle candidates over afterwards.

import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { safeFilename } from "../utils/safe-filename.js";

// --- Protocol constants ------------------------------------------------------

export const SIGNAL_PREFIX = "MFK-P2P-1.";
// A base64url code longer than this is refused before any decompression runs.
// A real SDP with host candidates deflates to roughly 1–3 KB of base64.
export const MAX_SIGNAL_CODE_CHARS = 24000;
// Hard ceiling on the decompressed signaling JSON, so a crafted code cannot
// expand into a large allocation.
export const MAX_SIGNAL_BYTES = 128 * 1024;
// Both ends buffer a whole file in memory, so keep the ceiling honest.
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;
export const CHUNK_SIZE = 16 * 1024;
export const FRAME_HEADER_BYTES = 5;
// Keep at most this much queued in the DataChannel before pausing the sender.
export const SEND_HIGH_WATER = CHUNK_SIZE * 16;

export const FRAME_KIND = {
  META: 1,
  CHUNK: 2,
  FILE_END: 3,
  ACK: 4,
  CANCEL: 5,
  STROKE: 6,
  BOARD_CLEAR: 7,
  STROKE_UNDO: 8,
};

const FRAME_KIND_VALUES = new Set(Object.values(FRAME_KIND));

// --- base64url (no Buffer, no atob — identical in Node and the browser) ------

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < B64_ALPHABET.length; index += 1) {
    table[B64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

export function base64UrlEncode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = "";
  for (let index = 0; index < input.length; index += 3) {
    const a = input[index];
    const b = index + 1 < input.length ? input[index + 1] : -1;
    const c = index + 2 < input.length ? input[index + 2] : -1;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
    if (b < 0) break;
    out += B64_ALPHABET[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
    if (c < 0) break;
    out += B64_ALPHABET[c & 63];
  }
  return out;
}

export function base64UrlDecode(text) {
  const value = String(text || "");
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const digit = code < 128 ? B64_LOOKUP[code] : -1;
    if (digit < 0) throw new Error("This code contains characters that are not part of a MyFileKit code. Copy the whole code again.");
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 255;
      written += 1;
    }
  }
  return bytes.subarray(0, written);
}

// --- Manual signaling codes --------------------------------------------------

export function encodeSignal({ role, sdp }) {
  if (role !== "offer" && role !== "answer") throw new Error("A signaling code must be an offer or an answer.");
  if (typeof sdp !== "string" || !sdp.trim()) throw new Error("This browser produced an empty connection description. Reload the page and try again.");
  const payload = strToU8(JSON.stringify({ v: 1, role, sdp }));
  if (payload.length > MAX_SIGNAL_BYTES) throw new Error("This connection description is unexpectedly large and cannot be shared as a code.");
  const code = SIGNAL_PREFIX + base64UrlEncode(deflateSync(payload, { level: 9 }));
  if (code.length > MAX_SIGNAL_CODE_CHARS) throw new Error("This connection description is too large to share as a code.");
  return code;
}

export function decodeSignal(code) {
  const value = String(code || "").trim().replace(/\s+/g, "");
  if (!value) throw new Error("Paste a code first.");
  if (value.length > MAX_SIGNAL_CODE_CHARS) throw new Error("That code is too long to be a MyFileKit code.");
  if (!value.startsWith(SIGNAL_PREFIX)) throw new Error("That does not look like a MyFileKit connection code. It should start with " + SIGNAL_PREFIX);
  const body = value.slice(SIGNAL_PREFIX.length);
  if (!body) throw new Error("That code is empty after its prefix. Copy the whole code again.");

  let json;
  try {
    // Passing `out` caps the allocation: fflate never grows past this buffer, so
    // a compression bomb cannot balloon memory. An oversized payload gets
    // truncated instead, which then fails the JSON parse below.
    const inflated = inflateSync(base64UrlDecode(body), { out: new Uint8Array(MAX_SIGNAL_BYTES) });
    json = strFromU8(inflated);
  } catch {
    throw new Error("That code could not be read. Copy it again — codes cannot be edited or shortened.");
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That code is damaged or was cut short. Ask your peer to send the whole code again.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("That code does not contain a connection description.");
  if (parsed.v !== 1) throw new Error("That code was made by a different version of this tool. Both sides need the same MyFileKit version.");
  if (parsed.role !== "offer" && parsed.role !== "answer") throw new Error("That code does not say whether it is an invite or an answer.");
  if (typeof parsed.sdp !== "string" || !parsed.sdp.includes("v=0")) throw new Error("That code does not contain a usable connection description.");
  if (parsed.sdp.length > MAX_SIGNAL_BYTES) throw new Error("That code's connection description is too large.");
  return { role: parsed.role, sdp: parsed.sdp };
}

// --- Frame framing -----------------------------------------------------------
//
// Every DataChannel message is binary:
//   byte 0      kind (see FRAME_KIND)
//   bytes 1..4  sequence number, big endian (only meaningful for CHUNK)
//   bytes 5..   payload

export function encodeFrame(kind, seq, payload) {
  if (!FRAME_KIND_VALUES.has(kind)) throw new Error(`Unknown frame kind ${kind}.`);
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) throw new Error("Frame sequence number is out of range.");
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
  const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  frame[0] = kind;
  frame[1] = (seq >>> 24) & 255;
  frame[2] = (seq >>> 16) & 255;
  frame[3] = (seq >>> 8) & 255;
  frame[4] = seq & 255;
  frame.set(body, FRAME_HEADER_BYTES);
  return frame;
}

export function decodeFrame(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (input.length < FRAME_HEADER_BYTES) throw new Error("The peer sent a message that is too short to be valid.");
  const kind = input[0];
  if (!FRAME_KIND_VALUES.has(kind)) throw new Error("The peer sent a message this version does not understand.");
  const seq = ((input[1] << 24) | (input[2] << 16) | (input[3] << 8) | input[4]) >>> 0;
  return { kind, seq, payload: input.subarray(FRAME_HEADER_BYTES) };
}

export function encodeJsonFrame(kind, value) {
  return encodeFrame(kind, 0, strToU8(JSON.stringify(value ?? {})));
}

export function decodeJsonFrame(frame) {
  if (frame.payload.length > MAX_SIGNAL_BYTES) throw new Error("The peer sent an oversized control message.");
  let parsed;
  try {
    parsed = JSON.parse(strFromU8(frame.payload));
  } catch {
    throw new Error("The peer sent a control message that could not be read.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The peer sent a control message in an unexpected shape.");
  return parsed;
}

export function chunkBytes(bytes, size = CHUNK_SIZE) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const step = Number.isInteger(size) && size > 0 ? size : CHUNK_SIZE;
  const chunks = [];
  for (let offset = 0; offset < input.length; offset += step) {
    chunks.push(input.subarray(offset, Math.min(offset + step, input.length)));
  }
  return chunks;
}

// Reassembles CHUNK frames into one buffer. The DataChannel is ordered and
// reliable, so anything out of order means a protocol violation, not a retry.
export function createAssembler({ size, maxBytes = MAX_TRANSFER_BYTES }) {
  if (!Number.isInteger(size) || size < 0) throw new Error("The peer announced an invalid file size.");
  if (size > maxBytes) throw new Error(`The peer's file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit this tool accepts.`);
  const buffer = new Uint8Array(size);
  let received = 0;
  let nextSeq = 0;
  return {
    get size() { return size; },
    get received() { return received; },
    get complete() { return received === size; },
    push(frame) {
      if (frame.kind !== FRAME_KIND.CHUNK) throw new Error("Expected file data but the peer sent something else.");
      if (frame.seq !== nextSeq) throw new Error(`File data arrived out of order (expected chunk ${nextSeq}, got ${frame.seq}). The transfer was stopped.`);
      if (received + frame.payload.length > size) throw new Error("The peer sent more data than it announced. The transfer was stopped.");
      buffer.set(frame.payload, received);
      received += frame.payload.length;
      nextSeq += 1;
      return received;
    },
    finish() {
      if (received !== size) throw new Error("The transfer ended before the whole file arrived.");
      return buffer;
    },
  };
}

// --- Integrity ---------------------------------------------------------------

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new Error("This browser cannot hash files, so transfers cannot be verified. Use an up-to-date browser over HTTPS.");
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  // digest() wants a real ArrayBuffer view without a shared offset surprise.
  const digest = await subtle.digest("SHA-256", input.slice());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyBytes(bytes, expectedHash) {
  if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)) return { verified: false, hash: await sha256Hex(bytes) };
  const hash = await sha256Hex(bytes);
  return { verified: hash === expectedHash, hash };
}

// --- Untrusted peer input ----------------------------------------------------

// The remote peer controls this string entirely. Strip any path, keep only a
// short conservative extension, and run the stem through the app's own
// filename sanitiser so nothing path-like or shell-like survives.
export function sanitizeReceivedFilename(name, fallback = "myfilekit-received") {
  const base = String(name ?? "").split(/[\\/]/).pop() || "";
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(base);
  const extension = match ? match[1].toLowerCase() : "";
  const stem = safeFilename(base, fallback);
  return extension ? `${stem}.${extension}` : stem;
}

export function sanitizeMimeType(type) {
  const value = String(type ?? "").trim().toLowerCase();
  // Deliberately narrow: anything unusual becomes a plain download.
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(value)) return "application/octet-stream";
  return value;
}

// Peer strings are only ever rendered as React text nodes, never as HTML. Even
// so, control characters and bidi overrides can rewrite how the surrounding UI
// text reads, so strip them and cap the length.
const UNSAFE_PEER_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

export function sanitizePeerText(text, maxLength = 200) {
  return String(text ?? "").replace(UNSAFE_PEER_TEXT, "").slice(0, maxLength);
}

export function normalizeIncomingMeta(meta, { maxBytes = MAX_TRANSFER_BYTES } = {}) {
  if (!meta || typeof meta !== "object") throw new Error("The peer sent file details in an unexpected shape.");
  const size = Number(meta.size);
  if (!Number.isInteger(size) || size < 0) throw new Error("The peer announced an invalid file size.");
  if (size > maxBytes) throw new Error(`The peer wants to send ${Math.round(size / (1024 * 1024))} MB, which is over the ${Math.round(maxBytes / (1024 * 1024))} MB limit this tool accepts. Ask them to send a smaller file.`);
  const hash = typeof meta.hash === "string" && /^[0-9a-f]{64}$/.test(meta.hash) ? meta.hash : "";
  const index = Number.isInteger(meta.index) && meta.index >= 0 ? meta.index : 0;
  const total = Number.isInteger(meta.total) && meta.total > 0 ? Math.min(meta.total, 50) : 1;
  return {
    name: sanitizeReceivedFilename(meta.name),
    size,
    type: sanitizeMimeType(meta.type),
    hash,
    index,
    total,
  };
}

// --- Optional user-supplied ICE servers --------------------------------------

const ICE_SCHEMES = ["stun:", "stuns:", "turn:", "turns:"];
export const MAX_ICE_SERVERS = 4;

// Nothing is baked in: with an empty input the peer connection uses no ICE
// servers at all, which is why the UI says "same network" by default.
export function parseIceServers(input) {
  const entries = String(input || "").split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
  if (!entries.length) return [];
  if (entries.length > MAX_ICE_SERVERS) throw new Error(`Enter no more than ${MAX_ICE_SERVERS} ICE servers.`);
  return entries.map((entry) => {
    const parts = entry.split("|").map((part) => part.trim());
    const url = parts[0];
    const lower = url.toLowerCase();
    if (!ICE_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
      throw new Error(`"${url}" is not usable. An ICE server URL must start with stun:, stuns:, turn:, or turns:`);
    }
    if (/[\s"'<>\\]/.test(url) || url.length > 200) throw new Error(`"${url.slice(0, 40)}" is not a valid ICE server URL.`);
    const server = { urls: url };
    if (lower.startsWith("turn")) {
      const [, username, credential] = parts;
      if (!username || !credential) throw new Error(`A turn: server needs credentials. Use the form turn:host:port|username|password`);
      if (username.length > 200 || credential.length > 200) throw new Error("TURN credentials are too long.");
      server.username = username;
      server.credential = credential;
    }
    return server;
  });
}

// --- Progress helpers (pure) -------------------------------------------------

export function transferRate(bytes, elapsedMs) {
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (bytes * 1000) / elapsedMs;
}

export function progressPercent(sent, total) {
  if (!Number.isFinite(total) || total <= 0) return sent > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
}

// ============================================================================
// Browser-only below this line. Nothing here runs at import time, so Node tests
// can import this module safely. WebRTC, DataChannel, and timer paths are
// exercised in a real browser only.
// ============================================================================

export function webrtcSupported() {
  return typeof RTCPeerConnection === "function";
}

// Vanilla ICE: wait for gathering to finish so the code we hand the user
// already contains every candidate. The timeout stops a browser that never
// reports "complete" from hanging the UI forever.
export function waitForIceGathering(pc, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve(pc.localDescription);
      return;
    }
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      pc.removeEventListener("icecandidate", onCandidate);
      resolve(pc.localDescription);
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const onCandidate = (event) => {
      if (!event.candidate) finish();
    };
    pc.addEventListener("icegatheringstatechange", onStateChange);
    pc.addEventListener("icecandidate", onCandidate);
    timer = setTimeout(finish, timeoutMs);
  });
}

// One peer connection plus one ordered DataChannel, with manual signaling and a
// single close() that releases everything.
/**
 * @param {{
 *   iceServersText?: string,
 *   onFrame?: (frame: { kind: number, seq: number, payload: Uint8Array }) => void,
 *   onOpen?: () => void,
 *   onClose?: (reason?: string) => void,
 *   onError?: (error: Error) => void,
 * }} [options]
 */
export function createPeerLink({ iceServersText = "", onFrame, onOpen, onClose, onError } = {}) {
  if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so direct peer transfers are not available here.");
  const iceServers = parseIceServers(iceServersText);
  const pc = new RTCPeerConnection({ iceServers });
  let channel = null;
  let closed = false;

  // Fires at most once, and never after an explicit close() (which sets the
  // same flag first), so the UI cannot be told "peer disconnected" for a
  // teardown it asked for itself.
  const notifyClosed = (reason) => {
    if (closed) return;
    closed = true;
    releaseChannel();
    onClose?.(reason);
  };

  function releaseChannel() {
    if (!channel) return;
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Already closing.
    }
    channel = null;
  }

  function wireChannel(next) {
    channel = next;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = CHUNK_SIZE * 4;
    channel.onopen = () => onOpen?.();
    channel.onclose = () => notifyClosed("closed");
    channel.onerror = () => notifyClosed("error");
    channel.onmessage = (event) => {
      try {
        // Peer data only ever reaches the app as bytes through decodeFrame;
        // a text message means the peer is not speaking this protocol.
        if (typeof event.data === "string") throw new Error("The peer sent a text message this tool does not use.");
        onFrame?.(decodeFrame(new Uint8Array(event.data)));
      } catch (error) {
        onError?.(error);
      }
    };
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      onError?.(new Error("The direct connection to your peer dropped. Without a STUN/TURN server this only works when both devices are on the same network."));
      notifyClosed(pc.connectionState);
    }
  };

  return {
    get iceServerCount() { return iceServers.length; },
    isOpen() {
      return !closed && channel?.readyState === "open";
    },
    // Lets a caller waiting for the channel to open give up immediately once the
    // connection is gone, instead of sitting out its whole timeout.
    isClosed() {
      return closed;
    },
    async createInvite() {
      wireChannel(pc.createDataChannel("myfilekit", { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      const description = await waitForIceGathering(pc);
      return encodeSignal({ role: "offer", sdp: description?.sdp || "" });
    },
    async acceptInvite(code) {
      const signal = decodeSignal(code);
      if (signal.role !== "answer") {
        pc.ondatachannel = (event) => wireChannel(event.channel);
        await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        const description = await waitForIceGathering(pc);
        return encodeSignal({ role: "answer", sdp: description?.sdp || "" });
      }
      throw new Error("That is an answer code, not an invite code. Paste the invite code your peer created first.");
    },
    async acceptAnswer(code) {
      const signal = decodeSignal(code);
      if (signal.role !== "answer") throw new Error("That is an invite code, not an answer code. Paste the answer code your peer sent back.");
      await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    },
    sendFrame(bytes) {
      if (!channel || channel.readyState !== "open") throw new Error("The peer connection is not open.");
      channel.send(bytes);
    },
    // Pause the sender when the DataChannel queue grows, so a large file cannot
    // balloon the send buffer. Polls as well as listening, because
    // "bufferedamountlow" is not fired consistently across browsers.
    waitForDrain() {
      if (!channel || channel.readyState !== "open") return Promise.reject(new Error("The peer connection closed before the transfer finished."));
      if (channel.bufferedAmount <= SEND_HIGH_WATER) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const current = channel;
        let poll = null;
        const cleanup = () => {
          if (poll !== null) clearInterval(poll);
          current.removeEventListener("bufferedamountlow", onLow);
        };
        const onLow = () => {
          cleanup();
          resolve();
        };
        poll = setInterval(() => {
          if (current.readyState !== "open") {
            cleanup();
            reject(new Error("The peer connection closed before the transfer finished."));
            return;
          }
          if (current.bufferedAmount <= SEND_HIGH_WATER) {
            cleanup();
            resolve();
          }
        }, 100);
        current.addEventListener("bufferedamountlow", onLow);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      releaseChannel();
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    },
  };
}

// Streams one File over an open link: metadata, then 16 KB chunks with
// backpressure, then a FILE_END carrying the SHA-256 the receiver checks.
/**
 * @param {ReturnType<typeof createPeerLink>} link
 * @param {File} file
 * @param {{
 *   index?: number,
 *   total?: number,
 *   onProgress?: (progress: { sent: number, total: number, elapsedMs: number }) => void,
 *   shouldCancel?: () => boolean,
 * }} [options]
 */
export async function sendFileOverLink(link, file, { index = 0, total = 1, onProgress, shouldCancel } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_TRANSFER_BYTES) throw new Error(`${file.name} is larger than the ${Math.round(MAX_TRANSFER_BYTES / (1024 * 1024))} MB limit for direct transfers.`);
  const hash = await sha256Hex(bytes);
  link.sendFrame(encodeJsonFrame(FRAME_KIND.META, { name: file.name, size: bytes.length, type: file.type, hash, index, total }));

  const startedAt = Date.now();
  let seq = 0;
  let sent = 0;
  onProgress?.({ sent, total: bytes.length, elapsedMs: 0 });
  for (const chunk of chunkBytes(bytes, CHUNK_SIZE)) {
    if (shouldCancel?.()) {
      try {
        link.sendFrame(encodeJsonFrame(FRAME_KIND.CANCEL, { reason: "cancelled" }));
      } catch {
        // The channel may already be gone; cancelling is best effort.
      }
      throw new Error("Transfer cancelled.");
    }
    await link.waitForDrain();
    link.sendFrame(encodeFrame(FRAME_KIND.CHUNK, seq, chunk));
    seq += 1;
    sent += chunk.length;
    onProgress?.({ sent, total: bytes.length, elapsedMs: Date.now() - startedAt });
  }
  link.sendFrame(encodeJsonFrame(FRAME_KIND.FILE_END, { index, hash }));
  return { hash, bytes: bytes.length, chunks: seq };
}
