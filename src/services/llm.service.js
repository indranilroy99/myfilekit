/**
 * OPTIONAL "bring your own LLM endpoint" adapter.
 *
 * MyFileKit is local-first: every other service in this app runs entirely in the
 * browser. This module is the one deliberate exception, and it is opt-in in
 * three separate ways:
 *
 *   1. Nothing here runs until the user saves an endpoint AND ticks "enabled".
 *   2. `requestChatCompletion` refuses — before it touches `fetch` — whenever the
 *      settings are missing or switched off, so an unconfigured install can make
 *      no outbound request at all.
 *   3. The calling UI has to label the button as leaving the device, and the
 *      user has to press it.
 *
 * The shipped Content-Security-Policy is `default-src 'self'` with no
 * `connect-src` exception, so a browser will block any endpoint the operator has
 * not explicitly allowed. That block is caught and reported as actionable
 * guidance rather than a generic network error.
 *
 * The API key lives only in `localStorage` on the user's device. It is never
 * logged, never placed in a URL or query string, and only ever leaves as an
 * `Authorization` header on the request the user asked for.
 */

const STORAGE_KEY = "myfilekit:llm-endpoint";

/** Hard cap on how much document text a single request may carry. */
export const MAX_PROMPT_CHARACTERS = 24000;

export const EMPTY_LLM_SETTINGS = Object.freeze({ enabled: false, baseUrl: "", model: "", apiKey: "" });

function storageOf(options = {}) {
  if (options.storage) return options.storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private-mode browsers can throw on access.
    return null;
  }
}

/** Reads the saved endpoint. Returns the empty settings when nothing is stored. */
export function readLlmSettings(options = {}) {
  const storage = storageOf(options);
  if (!storage) return { ...EMPTY_LLM_SETTINGS };
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { ...EMPTY_LLM_SETTINGS };
  }
  if (!raw) return { ...EMPTY_LLM_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled === true,
      baseUrl: String(parsed?.baseUrl || ""),
      model: String(parsed?.model || ""),
      apiKey: String(parsed?.apiKey || ""),
    };
  } catch {
    return { ...EMPTY_LLM_SETTINGS };
  }
}

/**
 * Validates and stores the endpoint on this device only. Returns the normalised
 * settings so the caller can render them without re-reading storage.
 */
export function saveLlmSettings(settings, options = {}) {
  const normalised = {
    enabled: settings?.enabled === true,
    baseUrl: normaliseBaseUrl(settings?.baseUrl),
    model: String(settings?.model || "").trim(),
    apiKey: String(settings?.apiKey || "").trim(),
  };
  if (normalised.enabled) {
    if (!normalised.baseUrl) throw new Error("Enter the base URL of your OpenAI-compatible endpoint.");
    if (!normalised.model) throw new Error("Enter the model name your endpoint expects.");
    if (!normalised.apiKey) throw new Error("Enter the API key for your endpoint.");
  }
  const storage = storageOf(options);
  if (!storage) throw new Error("This browser cannot store settings, so an endpoint cannot be saved.");
  storage.setItem(STORAGE_KEY, JSON.stringify(normalised));
  return normalised;
}

export function clearLlmSettings(options = {}) {
  const storage = storageOf(options);
  if (!storage) return { ...EMPTY_LLM_SETTINGS };
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to do: the value is unreachable either way.
  }
  return { ...EMPTY_LLM_SETTINGS };
}

function normaliseBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("The endpoint base URL must be a full URL, for example https://api.example.com/v1");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The endpoint base URL must use https:// (or http:// for a local endpoint).");
  }
  if (url.username || url.password) {
    throw new Error("Do not put credentials in the URL. The API key belongs in the API key field.");
  }
  if (url.search || url.hash) {
    throw new Error("Remove the query string from the base URL. The API key is never sent in a URL.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** True when an endpoint is saved, complete, and switched on. */
export function isLlmConfigured(settings) {
  return Boolean(settings?.enabled && settings?.baseUrl && settings?.model && settings?.apiKey);
}

/** Origin the browser must be allowed to reach, for CSP guidance. */
export function endpointOrigin(baseUrl) {
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
  const origin = endpointOrigin(baseUrl) || "https://your-endpoint.example";
  return [
    `Add "connect-src 'self' ${origin}" to the Content-Security-Policy in both index.html and public/_headers, then rebuild and redeploy.`,
    "The default MyFileKit policy allows no outbound connections on purpose, so this only works on a deploy you control.",
  ].join(" ");
}

export function truncateForPrompt(text, limit = MAX_PROMPT_CHARACTERS) {
  const value = String(text || "");
  const max = Math.max(1, Math.trunc(Number(limit) || MAX_PROMPT_CHARACTERS));
  if (value.length <= max) return { text: value, truncated: false, characters: value.length };
  return { text: value.slice(0, max), truncated: true, characters: max };
}

export function buildSummaryPrompt(documentText, { maxWords = 180, limit = MAX_PROMPT_CHARACTERS } = {}) {
  const { text, truncated } = truncateForPrompt(documentText, limit);
  if (!text.trim()) throw new Error("Extract the document text before requesting an abstractive summary.");
  return {
    system: "You summarise documents faithfully. Use only the supplied text. If something is not in the text, say so instead of inventing it.",
    prompt: [
      `Write a summary of at most ${Math.max(40, Math.trunc(maxWords))} words for the document below.`,
      truncated ? "The document was truncated to fit the request; summarise only what is present." : "",
      "---",
      text,
    ].filter(Boolean).join("\n"),
    truncated,
  };
}

export function buildAnswerPrompt(question, passages, { limit = MAX_PROMPT_CHARACTERS } = {}) {
  const query = String(question || "").trim();
  if (!query) throw new Error("Ask a question first.");
  const list = Array.isArray(passages) ? passages : [];
  if (!list.length) throw new Error("Retrieve passages before requesting a generated answer.");
  const body = list.map((entry, position) => `[${position + 1}] (page ${entry.page}) ${entry.chunk?.text ?? entry.text ?? ""}`).join("\n\n");
  const { text, truncated } = truncateForPrompt(body, limit);
  return {
    system: "You answer strictly from the supplied passages. Cite the page number for every claim. If the passages do not answer the question, say that plainly.",
    prompt: [
      `Question: ${query}`,
      "",
      "Passages retrieved from the document:",
      text,
      "",
      "Answer using only these passages and cite page numbers.",
    ].join("\n"),
    truncated,
  };
}

/**
 * Sends one chat completion to the user's own endpoint.
 *
 * Refuses without any network access when the endpoint is absent or disabled, so
 * a default install cannot leak a document even if this function is called by
 * mistake. `fetchImpl` exists so the refusal path is unit-testable in Node.
 */
export async function requestChatCompletion({ settings, system, prompt, maxTokens, temperature, signal, fetchImpl } = {}) {
  if (!settings?.enabled) {
    throw new Error("The optional AI endpoint is switched off. Nothing was sent. Turn it on in the AI endpoint panel to use it.");
  }
  if (!isLlmConfigured(settings)) {
    throw new Error("The optional AI endpoint is incomplete. Nothing was sent. Add a base URL, model, and API key first.");
  }
  if (!String(prompt || "").trim()) throw new Error("There is nothing to send.");

  const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!request) throw new Error("This browser has no fetch API, so a remote endpoint cannot be used.");

  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content: String(prompt) });

  let response;
  try {
    response = await request(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        // The key travels only in this header, never in the URL.
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
        max_tokens: Math.max(64, Math.trunc(Number(maxTokens) || 700)),
        stream: false,
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The request was cancelled.");
    // A CSP refusal, a DNS failure, and a CORS rejection all surface as an
    // opaque TypeError, and CSP is by far the likeliest cause here.
    throw new Error(`The browser blocked or could not reach ${endpointOrigin(settings.baseUrl) || "your endpoint"}. ${cspGuidance(settings.baseUrl)} If the policy already allows it, check that the endpoint is reachable and sends CORS headers.`);
  }

  if (!response.ok) {
    throw new Error(`Your endpoint answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the model name, the API key, and the endpoint path.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Your endpoint did not return JSON, so the reply could not be read.");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Your endpoint returned no message content.");
  }
  return content.trim();
}

export const LLM_STORAGE_KEY = STORAGE_KEY;
