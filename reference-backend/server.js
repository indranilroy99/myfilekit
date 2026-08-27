/**
 * MyFileKit "Request e-Signature" — REFERENCE signing backend.
 *
 * This is a minimal, dependency-free (Node stdlib only) reference an operator can
 * deploy so the optional Request e-Signature tool in MyFileKit has somewhere to
 * upload envelopes to. It is deliberately NOT part of the MyFileKit app build and
 * adds no dependency to the app: it lives in its own directory with its own
 * package.json.
 *
 * It exposes:
 *   POST /envelopes            accept a PDF + signer list, store it, return an id,
 *                              and "email" each signer a signing link (stubbed).
 *   GET  /envelopes/:id        the envelope's status and per-signer status.
 *   POST /envelopes/:id/sign   a signer submits their signature (typed name).
 *   GET  /envelopes/:id/download   the final PDF once every signer has signed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY — READ THIS BEFORE DEPLOYING
 * Once this runs, YOU hold other people's PDFs and email addresses. This
 * reference is intentionally simple and is NOT production-ready as written:
 *   • Storage is IN MEMORY. Everything is lost on restart. A real deploy needs a
 *     store you control, with encryption at rest.
 *   • There is no authentication on the read/sign/download routes beyond an
 *     unguessable id. Add real auth (per-signer tokens) before real use.
 *   • Serve it over TLS (HTTPS) only. The MyFileKit client refuses to send a key
 *     in a URL, but the PDF itself is in the request body and must be encrypted
 *     in transit.
 *   • Set ALLOWED_ORIGIN to your MyFileKit origin. The wildcard default is for
 *     local development only.
 *   • Define and enforce a retention policy — delete envelopes when done.
 *   • The "final signed PDF" here is the ORIGINAL bytes plus an audit record. A
 *     real deploy would apply a visible signature and/or a cryptographic seal
 *     (see the TODO in `finalizeEnvelope`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 4444);
// Lock this to your MyFileKit origin in production, e.g. https://tools.example.com.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
// Optional shared secret. If set, requests must send Authorization: Bearer <key>.
// The MyFileKit client sends exactly this header when an API key is configured.
const API_KEY = process.env.API_KEY || "";

// In-memory store. Reference only — see the security note above.
/** @type {Map<string, any>} */
const envelopes = new Map();

const MAX_BODY_BYTES = 40 * 1024 * 1024; // refuse absurd uploads before buffering more

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!API_KEY) return true; // no key required in this deploy
  const header = req.headers["authorization"] || "";
  return header === `Bearer ${API_KEY}`;
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /envelopes — accept { fileName, contentType, size, pdfBase64, signers, message }
async function createEnvelope(req, res) {
  const body = await readJsonBody(req);
  const pdfBase64 = String(body?.pdfBase64 || "");
  if (!pdfBase64) return send(res, 400, { error: "pdfBase64 is required." });

  let pdf;
  try {
    pdf = Buffer.from(pdfBase64, "base64");
  } catch {
    return send(res, 400, { error: "pdfBase64 is not valid base64." });
  }
  if (!pdf.length) return send(res, 400, { error: "The PDF is empty." });
  // A real deploy should also verify the %PDF- magic and re-scan for active
  // content before storing or forwarding the file.
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return send(res, 400, { error: "That upload is not a PDF." });
  }

  const signerList = Array.isArray(body?.signers) ? body.signers : [];
  const emails = [];
  for (const entry of signerList) {
    const email = String(entry?.email || "").trim();
    if (!EMAIL_SHAPE.test(email)) return send(res, 400, { error: `"${email}" is not a valid email.` });
    emails.push(email);
  }
  if (!emails.length) return send(res, 400, { error: "At least one signer is required." });

  const id = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const envelope = {
    id,
    status: "sent",
    createdAt: now,
    fileName: String(body?.fileName || "document.pdf"),
    message: String(body?.message || ""),
    pdf, // Buffer — reference only; encrypt at rest in a real deploy.
    signers: emails.map((email) => ({
      email,
      status: "pending",
      // Unguessable per-signer token. In a real deploy the signing link carries
      // this and the sign route requires it.
      token: crypto.randomBytes(12).toString("hex"),
    })),
  };
  envelopes.set(id, envelope);

  // TODO(operator): actually email each signer their signing link. This stub
  // just logs it. Wire in your transactional email provider (SES, Postmark, …).
  for (const signer of envelope.signers) {
    const link = `${publicBase(req)}/sign.html?envelope=${id}&token=${signer.token}`;
    console.log(`[esign] TODO email ${signer.email}: please sign "${envelope.fileName}" → ${link}`);
  }

  return send(res, 201, { id, status: envelope.status, signers: publicSigners(envelope) });
}

// GET /envelopes/:id
function getEnvelope(res, id) {
  const envelope = envelopes.get(id);
  if (!envelope) return send(res, 404, { error: "No envelope with that id." });
  return send(res, 200, {
    id: envelope.id,
    status: envelope.status,
    fileName: envelope.fileName,
    createdAt: envelope.createdAt,
    signers: publicSigners(envelope),
  });
}

// POST /envelopes/:id/sign — { email, token, signatureName }
async function signEnvelope(req, res, id) {
  const envelope = envelopes.get(id);
  if (!envelope) return send(res, 404, { error: "No envelope with that id." });
  const body = await readJsonBody(req);
  const email = String(body?.email || "").trim().toLowerCase();
  const token = String(body?.token || "");
  const signatureName = String(body?.signatureName || "").trim();

  const signer = envelope.signers.find((s) => s.email.toLowerCase() === email);
  if (!signer) return send(res, 404, { error: "That email is not a signer on this envelope." });
  // Constant-time-ish token check. A real deploy MUST require this token.
  if (signer.token !== token) return send(res, 403, { error: "Invalid or missing signing token." });
  if (!signatureName) return send(res, 400, { error: "A signature (typed name) is required." });

  signer.status = "signed";
  signer.signatureName = signatureName;
  signer.signedAt = new Date().toISOString();

  if (envelope.signers.every((s) => s.status === "signed")) finalizeEnvelope(envelope);

  return send(res, 200, { id: envelope.id, status: envelope.status, signers: publicSigners(envelope) });
}

// GET /envelopes/:id/download — the final PDF once completed.
function downloadEnvelope(res, id) {
  const envelope = envelopes.get(id);
  if (!envelope) return send(res, 404, { error: "No envelope with that id." });
  if (envelope.status !== "completed") return send(res, 409, { error: "The envelope is not fully signed yet." });
  const pdf = envelope.finalPdf || envelope.pdf;
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${envelope.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  });
  res.end(pdf);
}

function finalizeEnvelope(envelope) {
  envelope.status = "completed";
  envelope.completedAt = new Date().toISOString();
  // TODO(operator): produce a truly signed PDF here — e.g. stamp each signer's
  // visible signature block and/or apply a cryptographic seal (PAdES). This
  // reference returns the ORIGINAL bytes; the audit trail lives in the signer
  // records returned by GET /envelopes/:id. Do NOT present the reference output
  // as a legally sealed document.
  envelope.finalPdf = envelope.pdf;
}

// Never expose the raw PDF bytes or per-signer tokens in status responses.
function publicSigners(envelope) {
  return envelope.signers.map((s) => ({
    email: s.email,
    status: s.status,
    signatureName: s.signatureName || undefined,
    signedAt: s.signedAt || undefined,
  }));
}

function publicBase(req) {
  const host = req.headers["host"] || `localhost:${PORT}`;
  // Behind TLS termination this should be https; adjust for your proxy.
  return `http://${host}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, undefined);
    if (!authorized(req)) return send(res, 401, { error: "Missing or invalid Authorization header." });

    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "POST" && path === "/envelopes") return await createEnvelope(req, res);

    const match = path.match(/^\/envelopes\/([A-Za-z0-9_-]{1,128})(\/sign|\/download)?$/);
    if (match) {
      const id = match[1];
      const action = match[2] || "";
      if (req.method === "GET" && !action) return getEnvelope(res, id);
      if (req.method === "POST" && action === "/sign") return await signEnvelope(req, res, id);
      if (req.method === "GET" && action === "/download") return downloadEnvelope(res, id);
    }

    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 400, { error: error?.message || "Bad request." });
  }
});

server.listen(PORT, () => {
  console.log(`[esign] reference backend listening on http://localhost:${PORT}`);
  console.log(`[esign] ALLOWED_ORIGIN=${ALLOWED_ORIGIN}${API_KEY ? " (API key required)" : " (no API key required)"}`);
});
