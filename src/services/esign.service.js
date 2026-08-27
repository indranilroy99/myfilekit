/**
 * OPTIONAL "request e-signature" client (Tier 3, off by default).
 *
 * MyFileKit is local-first: every other tool runs entirely in the browser and
 * uploads nothing. This module is a deliberate exception and the ONE place a
 * selected PDF is uploaded off the device — and only to a signing backend the
 * operator themselves has deployed and configured. It is opt-in in the same
 * three ways the bring-your-own-LLM adapter is:
 *
 *   1. Nothing here runs until the operator saves a backend base URL AND ticks
 *      "enabled".
 *   2. `requestEnvelope` / `getEnvelopeStatus` refuse — before they touch
 *      `fetch` — whenever the settings are missing or switched off, so an
 *      unconfigured install can make no outbound request at all.
 *   3. The calling UI has to label the button as uploading the PDF off the
 *      device, and the user has to press it.
 *
 * The shipped Content-Security-Policy is `default-src 'self'` with `connect-src
 * 'self'` and no exception, so a browser will block any backend the operator has
 * not explicitly allowed. That block is caught and reported as actionable
 * connect-src guidance rather than a generic network error.
 *
 * Any backend API key lives only in `localStorage` on the operator's device. It
 * is never logged, never placed in a URL or query string, and only ever leaves
 * as an `Authorization` header on the request the user asked for. The PDF is
 * sent only in the request body, never in a URL.
 */

const STORAGE_KEY = "myfilekit:esign-backend";

/** Hard cap on the PDF size the client will attempt to upload (32 MB). */
export const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024;

/** Hard cap on how many signers one envelope may carry. */
export const MAX_SIGNERS = 25;

export const EMPTY_ESIGN_SETTINGS = Object.freeze({ enabled: false, baseUrl: "", apiKey: "" });

function storageOf(options = {}) {
  if (options.storage) return options.storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private-mode browsers can throw on access.
    return null;
  }
}

/** Reads the saved backend. Returns the empty settings when nothing is stored. */
export function readEsignSettings(options = {}) {
  const storage = storageOf(options);
  if (!storage) return { ...EMPTY_ESIGN_SETTINGS };
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ...EMPTY_ESIGN_SETTINGS };
  }
  if (!raw) return { ...EMPTY_ESIGN_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled === true,
      baseUrl: String(parsed?.baseUrl || ""),
      apiKey: String(parsed?.apiKey || ""),
    };
  } catch {
    return { ...EMPTY_ESIGN_SETTINGS };
  }
}

/**
 * Validates and stores the backend on this device only. Returns the normalised
 * settings so the caller can render them without re-reading storage. The API key
 * is optional: some self-hosted backends need none.
 */
export function saveEsignSettings(settings, options = {}) {
  const normalised = {
    enabled: settings?.enabled === true,
    baseUrl: normaliseBaseUrl(settings?.baseUrl),
    apiKey: String(settings?.apiKey || "").trim(),
  };
  if (normalised.enabled && !normalised.baseUrl) {
    throw new Error("Enter the base URL of your signing backend.");
  }
  const storage = storageOf(options);
  if (!storage) throw new Error("This browser cannot store settings, so a backend cannot be saved.");
  storage.setItem(STORAGE_KEY, JSON.stringify(normalised));
  return normalised;
}

export function clearEsignSettings(options = {}) {
  const storage = storageOf(options);
  if (!storage) return { ...EMPTY_ESIGN_SETTINGS };
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to do: the value is unreachable either way.
  }
  return { ...EMPTY_ESIGN_SETTINGS };
}

function normaliseBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("The backend base URL must be a full URL, for example https://esign.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The backend base URL must use https:// (or http:// for a local backend).");
  }
  if (url.username || url.password) {
    throw new Error("Do not put credentials in the URL. The API key belongs in the API key field.");
  }
  if (url.search || url.hash) {
    throw new Error("Remove the query string from the base URL. The API key is never sent in a URL.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** True when a backend is saved and switched on. */
export function isEsignConfigured(settings) {
  return settings?.enabled === true && Boolean(settings?.baseUrl);
}

/** Origin the browser must be allowed to reach, for CSP guidance. */
export function backendOrigin(baseUrl) {
  try {
    return new URL(String(baseUrl || "")).origin;
  } catch {
    return "";
  }
}

/** Shows only the last four characters so a key is recognisable but not readable. */
export function maskApiKey(apiKey) {
  const key = String(apiKey || "");
  if (!key) return "";
  if (key.length <= 4) return "•".repeat(key.length);
  return `${"•".repeat(Math.min(20, key.length - 4))}${key.slice(-4)}`;
}

/** The exact CSP change an operator has to make in their own deploy. */
export function cspGuidance(baseUrl) {
  const origin = backendOrigin(baseUrl) || "https://your-backend.example";
  return [
    `Add "connect-src 'self' ${origin}" to the Content-Security-Policy in both index.html and public/_headers, then rebuild and redeploy.`,
    "The default MyFileKit policy allows no outbound connections on purpose, so this only works on a deploy you control.",
  ].join(" ");
}

/**
 * Parses a free-text list of signer emails (comma, semicolon, whitespace, or
 * newline separated) into a validated, de-duplicated array. Pure and
 * Node-testable. A malformed address is reported, not silently dropped.
 */
export function parseSigners(input) {
  const parts = String(input || "").split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  const emails = [];
  const seen = new Set();
  // Deliberately simple: one @, a dot in the domain, no spaces. The backend is
  // the real authority; this only catches obvious typos before an upload.
  const shape = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  for (const part of parts) {
    if (!shape.test(part)) throw new Error(`"${part}" is not a valid email address.`);
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(part);
  }
  if (!emails.length) throw new Error("Add at least one signer email address.");
  if (emails.length > MAX_SIGNERS) throw new Error(`Too many signers: at most ${MAX_SIGNERS} per envelope.`);
  return emails;
}

/** Base64-encodes bytes without a data: prefix. Works in both browser and Node. */
function base64Of(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(view).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Builds the JSON envelope payload the backend receives. Pure and Node-testable
 * so its exact shape can be asserted without any network. The PDF travels as
 * base64 in the request body only — never in a URL.
 *
 * @param {{ fileName?: string, contentType?: string, bytes: Uint8Array|ArrayBuffer }} pdf
 * @param {string[]} signers  validated emails from parseSigners
 * @param {string} [message]
 */
export function buildEnvelope(pdf, signers, message = "") {
  const bytes = pdf?.bytes instanceof Uint8Array ? pdf.bytes : pdf?.bytes ? new Uint8Array(pdf.bytes) : null;
  if (!bytes || !bytes.length) throw new Error("Choose a PDF to send for signature.");
  if (bytes.length > MAX_ENVELOPE_BYTES) {
    throw new Error(`That PDF is larger than the ${Math.round(MAX_ENVELOPE_BYTES / (1024 * 1024))} MB upload limit for a signing envelope.`);
  }
  const list = Array.isArray(signers) ? signers : [];
  if (!list.length) throw new Error("Add at least one signer email address.");
  return {
    fileName: String(pdf?.fileName || "document.pdf"),
    contentType: String(pdf?.contentType || "application/pdf"),
    size: bytes.length,
    pdfBase64: base64Of(bytes),
    signers: list.map((email) => ({ email: String(email) })),
    message: String(message || ""),
  };
}

/**
 * Uploads a signing envelope to the operator's own backend.
 *
 * Refuses without any network access when the backend is absent or disabled, so
 * a default install cannot upload a PDF even if this function is called by
 * mistake. `fetchImpl` exists so the refusal path and payload are unit-testable
 * in Node. Returns the backend's tracking id and status.
 *
 * @returns {Promise<{ id: string, status: string, signers: number }>}
 */
export async function requestEnvelope({ settings, file, signers, message, fetchImpl, signal } = {}) {
  // Strictly `true` only: a hand-built truthy value ("true", 1, {}) must not
  // count as "explicitly enabled".
  if (settings?.enabled !== true) {
    throw new Error("The e-signature backend is switched off. Nothing was uploaded. Turn it on in the signing backend panel to use it.");
  }
  if (!isEsignConfigured(settings)) {
    throw new Error("The e-signature backend is incomplete. Nothing was uploaded. Add the backend base URL first.");
  }

  const bytes = file?.bytes instanceof Uint8Array ? file.bytes : file?.bytes ? new Uint8Array(file.bytes) : null;
  if (!bytes || !bytes.length) throw new Error("Choose a PDF to send for signature.");
  const emails = Array.isArray(signers) ? signers : [];
  if (!emails.length) throw new Error("Add at least one signer email address.");

  // Build the payload only after the gate passes, so nothing is prepared for an
  // upload that will not happen.
  const envelope = buildEnvelope(file, emails, message);

  const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!request) throw new Error("This browser has no fetch API, so a signing backend cannot be used.");

  const url = `${settings.baseUrl.replace(/\/+$/, "")}/envelopes`;
  const headers = { "Content-Type": "application/json" };
  // The key travels only in this header, never in the URL.
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let response;
  try {
    response = await request(url, { method: "POST", signal, headers, body: JSON.stringify(envelope) });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The upload was cancelled.");
    // A CSP refusal, a DNS failure, and a CORS rejection all surface as an
    // opaque TypeError, and CSP is by far the likeliest cause here.
    throw new Error(`The browser blocked or could not reach ${backendOrigin(settings.baseUrl) || "your backend"}. ${cspGuidance(settings.baseUrl)} If the policy already allows it, check that the backend is reachable and sends CORS headers.`);
  }

  if (!response.ok) {
    throw new Error(`Your backend answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the backend URL, the API key, and that it exposes POST /envelopes.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Your backend did not return JSON, so the tracking id could not be read.");
  }
  const id = payload?.id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Your backend returned no envelope id.");
  return { id: id.trim(), status: String(payload?.status || "sent"), signers: emails.length };
}

/**
 * Reads the status of an envelope from the operator's own backend.
 *
 * Refuses before `fetch` when the backend is off or incomplete, exactly like
 * `requestEnvelope`, so a default install makes no request.
 *
 * @returns {Promise<{ id: string, status: string, signers: any[] }>}
 */
export async function getEnvelopeStatus({ settings, id, fetchImpl, signal } = {}) {
  if (settings?.enabled !== true) {
    throw new Error("The e-signature backend is switched off. Nothing was requested. Turn it on in the signing backend panel to use it.");
  }
  if (!isEsignConfigured(settings)) {
    throw new Error("The e-signature backend is incomplete. Nothing was requested. Add the backend base URL first.");
  }
  const trackingId = String(id || "").trim();
  if (!trackingId) throw new Error("Enter the envelope tracking id to check its status.");
  // The id is part of the path; reject anything that could escape it or leak
  // into a query string.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(trackingId)) {
    throw new Error("That tracking id has characters this tool will not put in a URL. Check the id.");
  }

  const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!request) throw new Error("This browser has no fetch API, so a signing backend cannot be used.");

  const url = `${settings.baseUrl.replace(/\/+$/, "")}/envelopes/${encodeURIComponent(trackingId)}`;
  const headers = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let response;
  try {
    response = await request(url, { method: "GET", signal, headers });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The status check was cancelled.");
    throw new Error(`The browser blocked or could not reach ${backendOrigin(settings.baseUrl) || "your backend"}. ${cspGuidance(settings.baseUrl)} If the policy already allows it, check that the backend is reachable and sends CORS headers.`);
  }
  if (response.status === 404) throw new Error("No envelope with that id was found on your backend.");
  if (!response.ok) {
    throw new Error(`Your backend answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the tracking id and the backend URL.`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Your backend did not return JSON, so the status could not be read.");
  }
  return {
    id: String(payload?.id || trackingId),
    status: String(payload?.status || "unknown"),
    signers: Array.isArray(payload?.signers) ? payload.signers : [],
  };
}

export const ESIGN_STORAGE_KEY = STORAGE_KEY;
