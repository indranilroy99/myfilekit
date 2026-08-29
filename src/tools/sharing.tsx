// Sharing & Collaboration tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../utils/format.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob, downloadBytes } from "../services/download.service.js";
import { canvasToPdf } from "../services/convert.service.js";
import { FRAME_KIND, MAX_TRANSFER_BYTES, createAssembler, createPeerLink, decodeJsonFrame, encodeJsonFrame, normalizeIncomingMeta, progressPercent, sendFileOverLink, transferRate, verifyBytes, webrtcSupported } from "../services/webrtc.service.js";
import { MAX_STROKES, addStrokePoint, createStroke, deserializeStrokeChunk, drawStrokeSegment, exportBoardCanvas, mergeStrokeChunk, pointFromEvent, prepareCanvas, renderBoard, serializeStrokeChunk } from "../services/whiteboard.service.js";
import { initialStatus, ToolForm, StatusBox, FileControl, Input, Textarea, Select, Checkbox, PrimaryButton, SecondaryButton, runSafely, canvasToBlob, copyText } from "./shared";
import type { Tool } from "./shared";

type PeerLink = ReturnType<typeof createPeerLink>;
type PeerFrame = { kind: number; seq: number; payload: Uint8Array };
type TransferProgressState = { label: string; sent: number; total: number; rate: number };
type ReceivedFile = { filename: string; size: number; type: string; verified: boolean; blob: Blob };

// Everything received stays in memory until the user downloads it, so cap the
// whole session, not only each file.
const P2P_SESSION_BUDGET = 512 * 1024 * 1024;
const ICE_HELP = "Nothing is built in. Any server you enter here is contacted directly by your browser, so it will learn your IP address. One per line: stun:host:port, or turn:host:port|username|password.";
const NO_ICE_HELP = "Off by default, so no third party is contacted. Without a STUN or TURN server the connection uses local network addresses only — both devices should be on the same Wi-Fi or LAN.";

function IceServerPanel({ enabled, setEnabled, value, onChange }: { enabled: boolean; setEnabled: (value: boolean) => void; value: string; onChange: (value: string) => void }) {
  return (
    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <Checkbox label="Use my own STUN/TURN server (contacts a third party)" checked={enabled} onChange={setEnabled} />
      {enabled ? <Textarea label="ICE servers" value={value} onChange={onChange} rows={3} /> : null}
      <p className="text-xs font-semibold leading-5 text-neutral-500">{enabled ? ICE_HELP : NO_ICE_HELP}</p>
    </div>
  );
}

function PeerCodeBox({ title, hint, code, onCopy }: { title: string; hint: string; code: string; onCopy: () => unknown }) {
  return (
    <div className="surface-muted wabi-card-edge grid gap-3 p-4">
      <div>
        <p className="text-xs font-bold uppercase text-neutral-500">{title}</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">{hint}</p>
      </div>
      <textarea
        className="field-input resize-y break-all font-mono text-xs leading-5"
        rows={4}
        value={code}
        readOnly
        aria-label={title}
        onFocus={(event) => event.currentTarget.select()}
      />
      <SecondaryButton label="Copy code" onClick={onCopy} />
    </div>
  );
}

function TransferProgressBar({ progress }: { progress: TransferProgressState }) {
  const percent = progressPercent(progress.sent, progress.total);
  return (
    <div className="surface-card wabi-card-edge grid gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
        <span className="min-w-0 break-all">{progress.label}</span>
        <span className="tabular-nums text-neutral-500">
          {percent}% · {formatBytes(progress.sent)} / {formatBytes(progress.total)}{progress.rate > 0 ? ` · ${formatBytes(progress.rate)}/s` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-soft)]" role="progressbar" aria-label={progress.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--moss)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Polls instead of waiting on an event, because a DataChannel that never opens
// (blocked by NAT, no ICE server) gives us nothing to listen for.
function waitForPeerOpen(link: PeerLink, timeoutMs = 45000) {
  return new Promise<void>((resolve, reject) => {
    if (link.isOpen()) {
      resolve();
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (link.isOpen()) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (link.isClosed()) {
        window.clearInterval(timer);
        reject(new Error("The connection closed before it opened. Both sides need to reset and swap fresh codes."));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("The direct connection could not be established. With no STUN/TURN server both devices must be on the same network — check that, or add your own server above and swap fresh codes."));
      }
    }, 250);
  });
}

function P2pShareTool({ tool }: { tool: Tool }) {
  const maxFileCount = (tool.file as { maxFiles?: number }).maxFiles || 1;
  const [role, setRole] = useState("sender");
  const [files, setFiles] = useState<File[]>([]);
  const [iceEnabled, setIceEnabled] = useState(false);
  const [iceText, setIceText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedCode, setPastedCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState<TransferProgressState | null>(null);
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  const [status, setStatus] = useState(initialStatus);

  const linkRef = useRef<PeerLink | null>(null);
  const cancelRef = useRef(false);
  const assemblerRef = useRef<ReturnType<typeof createAssembler> | null>(null);
  const metaRef = useRef<ReturnType<typeof normalizeIncomingMeta> | null>(null);
  const ackRef = useRef<{ resolve: (ok: boolean) => void; reject: (error: Error) => void } | null>(null);
  const startedRef = useRef(0);
  const paintedRef = useRef(0);
  const acceptedBytesRef = useRef(0);

  // One place that releases the connection, used by reset, cancel, and unmount,
  // so an RTCPeerConnection and DataChannel can never outlive the tool.
  const releaseLink = () => {
    const pending = ackRef.current;
    ackRef.current = null;
    pending?.reject(new Error("The transfer was stopped."));
    linkRef.current?.close();
    linkRef.current = null;
    assemblerRef.current = null;
    metaRef.current = null;
  };

  useEffect(() => () => {
    ackRef.current = null;
    linkRef.current?.close();
    linkRef.current = null;
    assemblerRef.current = null;
    metaRef.current = null;
  }, []);

  const finishIncoming = async () => {
    const assembler = assemblerRef.current;
    const meta = metaRef.current;
    if (!assembler || !meta) throw new Error("Your peer said a file had finished before sending it.");
    assemblerRef.current = null;
    metaRef.current = null;
    const bytes = assembler.finish();
    const { verified } = await verifyBytes(bytes, meta.hash);
    // Held as a Blob, never opened: the only way out is the download button.
    setReceived((current) => [...current, { filename: meta.name, size: meta.size, type: meta.type, verified, blob: new Blob([bytes], { type: meta.type }) }]);
    setProgress(null);
    try {
      linkRef.current?.sendFrame(encodeJsonFrame(FRAME_KIND.ACK, { index: meta.index, ok: verified }));
    } catch {
      // The peer may have gone; the file is already safe on this side.
    }
    setStatus(verified
      ? { tone: "success", message: `Received ${meta.name} (${formatBytes(meta.size)}). SHA-256 matches the sender's — the copy is intact. Download it below.` }
      : { tone: "error", message: `Received ${meta.name}, but its SHA-256 does not match what the sender announced. Do not trust this copy — ask them to send it again.` });
  };

  const handleFrame = (frame: PeerFrame) => {
    try {
      if (frame.kind === FRAME_KIND.META) {
        // Everything in here is attacker-controlled: name, size, type, hash.
        const meta = normalizeIncomingMeta(decodeJsonFrame(frame), { maxBytes: MAX_TRANSFER_BYTES });
        // Received files are held in memory until downloaded, so the session as
        // a whole has a budget, not just each individual file.
        if (acceptedBytesRef.current + meta.size > P2P_SESSION_BUDGET) {
          throw new Error(`This session has already accepted ${formatBytes(acceptedBytesRef.current)} and cannot hold ${meta.name} as well. Download what you have, reset, and reconnect.`);
        }
        acceptedBytesRef.current += meta.size;
        metaRef.current = meta;
        assemblerRef.current = createAssembler({ size: meta.size });
        startedRef.current = Date.now();
        paintedRef.current = 0;
        setProgress({ label: `Receiving ${meta.name}`, sent: 0, total: meta.size, rate: 0 });
        setStatus({ tone: "idle", message: `Receiving ${meta.name} (${formatBytes(meta.size)}) — file ${meta.index + 1} of ${meta.total}.` });
        return;
      }
      if (frame.kind === FRAME_KIND.CHUNK) {
        const assembler = assemblerRef.current;
        const meta = metaRef.current;
        if (!assembler || !meta) throw new Error("Your peer sent file data before saying what it was sending.");
        const bytes = assembler.push(frame);
        const now = Date.now();
        if (now - paintedRef.current > 150 || bytes === meta.size) {
          paintedRef.current = now;
          setProgress({ label: `Receiving ${meta.name}`, sent: bytes, total: meta.size, rate: transferRate(bytes, now - startedRef.current) });
        }
        return;
      }
      if (frame.kind === FRAME_KIND.FILE_END) {
        void finishIncoming().catch((error: any) => {
          assemblerRef.current = null;
          metaRef.current = null;
          setProgress(null);
          setStatus({ tone: "error", message: error?.message || "The incoming file could not be completed." });
        });
        return;
      }
      if (frame.kind === FRAME_KIND.ACK) {
        const body = decodeJsonFrame(frame);
        const pending = ackRef.current;
        ackRef.current = null;
        pending?.resolve(body.ok === true);
        return;
      }
      if (frame.kind === FRAME_KIND.CANCEL) {
        assemblerRef.current = null;
        metaRef.current = null;
        setProgress(null);
        const pending = ackRef.current;
        ackRef.current = null;
        pending?.reject(new Error("Your peer cancelled the transfer."));
        setStatus({ tone: "error", message: "Your peer cancelled the transfer." });
        return;
      }
      throw new Error("Your peer sent a message this tool does not use.");
    } catch (error: any) {
      assemblerRef.current = null;
      metaRef.current = null;
      setProgress(null);
      setStatus({ tone: "error", message: error?.message || "Your peer sent something unexpected." });
    }
  };

  const openLink = () => {
    if (linkRef.current) throw new Error("A connection is already set up here. Reset to start a new one.");
    const link = createPeerLink({
      iceServersText: iceEnabled ? iceText : "",
      onFrame: handleFrame,
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false);
        const pending = ackRef.current;
        ackRef.current = null;
        if (pending || assemblerRef.current) {
          pending?.reject(new Error("Your peer disconnected before the transfer finished."));
          assemblerRef.current = null;
          metaRef.current = null;
          setProgress(null);
          setStatus({ tone: "error", message: "Your peer disconnected before the transfer finished. Nothing partial was saved." });
        } else {
          setStatus((current) => current.tone === "error" ? current : { tone: "idle", message: "The peer connection closed. Reset to start another transfer." });
        }
      },
      onError: (error: any) => setStatus({ tone: "error", message: error?.message || "The peer connection reported a problem." }),
    });
    linkRef.current = link;
    return link;
  };

  const awaitAck = (timeoutMs = 180000) => new Promise<boolean>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      ackRef.current = null;
      reject(new Error("Your peer did not confirm the file in time."));
    }, timeoutMs);
    ackRef.current = {
      resolve: (ok: boolean) => {
        window.clearTimeout(timer);
        resolve(ok);
      },
      reject: (error: Error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    };
  });

  const createInvite = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so direct transfers are not available here.");
    const valid = validateFiles(files, tool.file);
    const code = await openLink().createInvite();
    setInviteCode(code);
    return `Invite code ready for ${valid.length} file${valid.length === 1 ? "" : "s"}. Send the code to your peer over a channel you already trust, then paste the answer code they send back.`;
  });

  const sendFiles = () => runSafely(setStatus, async () => {
    const link = linkRef.current;
    if (!link) throw new Error("Create an invite code first.");
    const valid = validateFiles(files, tool.file);
    if (!link.isOpen()) {
      await link.acceptAnswer(pastedCode);
      setStatus({ tone: "idle", message: "Answer accepted. Opening the direct connection…" });
      await waitForPeerOpen(link);
    }
    cancelRef.current = false;
    let verifiedCount = 0;
    for (let index = 0; index < valid.length; index += 1) {
      const file = valid[index];
      startedRef.current = Date.now();
      paintedRef.current = 0;
      setStatus({ tone: "idle", message: `Sending ${file.name} — file ${index + 1} of ${valid.length}.` });
      const ack = awaitAck();
      await sendFileOverLink(link, file, {
        index,
        total: valid.length,
        shouldCancel: () => cancelRef.current,
        onProgress: ({ sent, total, elapsedMs }: { sent: number; total: number; elapsedMs: number }) => {
          const now = Date.now();
          if (now - paintedRef.current <= 150 && sent !== total) return;
          paintedRef.current = now;
          setProgress({ label: `Sending ${file.name}`, sent, total, rate: transferRate(sent, elapsedMs) });
        },
      });
      setStatus({ tone: "idle", message: `Sent ${file.name}. Waiting for your peer to verify it…` });
      if (await ack) verifiedCount += 1;
    }
    setProgress(null);
    return verifiedCount === valid.length
      ? `Sent ${valid.length} file${valid.length === 1 ? "" : "s"}. Your peer verified every SHA-256 — the copies match.`
      : `Sent ${valid.length} file${valid.length === 1 ? "" : "s"}, but only ${verifiedCount} passed your peer's SHA-256 check. Send the rest again.`;
  });

  const createAnswer = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so direct transfers are not available here.");
    const code = await openLink().acceptInvite(pastedCode);
    setAnswerCode(code);
    return "Answer code ready. Send it back to whoever gave you the invite code, then leave this page open — files start arriving once the connection opens.";
  });

  const cancelTransfer = () => runSafely(setStatus, async () => {
    cancelRef.current = true;
    releaseLink();
    setConnected(false);
    setProgress(null);
    // Codes are single-use: a closed connection cannot be revived from them.
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    return "Transfer cancelled and the connection closed. Files already received stay listed below; start a new exchange with fresh codes.";
  });

  const reset = () => {
    cancelRef.current = true;
    releaseLink();
    setFiles([]);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setConnected(false);
    setProgress(null);
    setReceived([]);
    acceptedBytesRef.current = 0;
    setStatus(initialStatus);
  };

  const switchRole = (next: string) => {
    cancelRef.current = true;
    releaseLink();
    setRole(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setConnected(false);
    setProgress(null);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <p>Files travel straight from one browser to the other over an encrypted WebRTC data channel. There is no server in the middle and nothing is uploaded — but you have to hand your peer one code yourself, because MyFileKit has no backend to do it for you.</p>
      <p className="text-neutral-500">Works best when both devices are on the same network. Up to {Math.round(MAX_TRANSFER_BYTES / (1024 * 1024))} MB per file, {maxFileCount} files per session, sent one after another.</p>
    </div>

    <Select label="I am the" value={role} onChange={switchRole} options={["sender", "receiver"]} labels={["Sender — I have the files", "Receiver — I was given a code"]} />
    <IceServerPanel enabled={iceEnabled} setEnabled={setIceEnabled} value={iceText} onChange={setIceText} />

    {role === "sender" ? <>
      <FileControl accept="*/*" multiple files={files} setFiles={setFiles} label="Choose or drop the files to send" />
      {inviteCode
        ? <PeerCodeBox title="Step 1 · your invite code" hint="Send this whole code to your peer through a channel you already trust — chat, email, a shared note." code={inviteCode} onCopy={() => runSafely(setStatus, async () => { await copyText(inviteCode); return "Invite code copied."; })} />
        : <PrimaryButton label="Create invite code" onClick={createInvite} />}
      {inviteCode ? <>
        <Textarea label="Step 2 · paste your peer's answer code" value={pastedCode} onChange={setPastedCode} rows={4} />
        <div className="flex flex-wrap gap-2">
          <PrimaryButton label="Connect and send" onClick={sendFiles} />
          <SecondaryButton label="Cancel transfer" onClick={cancelTransfer} />
        </div>
      </> : null}
    </> : <>
      <Textarea label="Step 1 · paste the invite code you were given" value={pastedCode} onChange={setPastedCode} rows={4} />
      {answerCode
        ? <PeerCodeBox title="Step 2 · your answer code" hint="Send this whole code back to the sender. The transfer starts on its own once they paste it." code={answerCode} onCopy={() => runSafely(setStatus, async () => { await copyText(answerCode); return "Answer code copied."; })} />
        : <PrimaryButton label="Create answer code" onClick={createAnswer} />}
      {answerCode ? <SecondaryButton label="Cancel transfer" onClick={cancelTransfer} /> : null}
    </>}

    <p className="text-xs font-bold uppercase text-neutral-500">{connected ? "Connected to peer" : "Not connected"}</p>
    {progress ? <TransferProgressBar progress={progress} /> : null}

    {received.length > 0 ? (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="text-xs font-bold uppercase text-neutral-500">Received files · {received.length}</p>
        {received.map((item, index) => (
          <div key={`${item.filename}-${index}`} className="grid gap-2 border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
            <p className="break-all text-sm font-bold text-[var(--foreground)]">{item.filename}</p>
            <p className="text-xs font-semibold text-neutral-500">
              {formatBytes(item.size)} · {item.type} · {item.verified ? "SHA-256 verified" : "SHA-256 MISMATCH — do not trust this copy"}
            </p>
            <div>
              <SecondaryButton label="Download file" onClick={() => runSafely(setStatus, async () => {
                downloadBlob(item.blob, item.filename);
                return `Saved ${item.filename}.`;
              })} />
            </div>
          </div>
        ))}
        <p className="text-xs font-semibold leading-5 text-neutral-500">Received files are never opened or run here — the name has been stripped of any path and the only action offered is a download. Check anything you did not expect before opening it.</p>
      </div>
    ) : null}
  </ToolForm>;
}

function WhiteboardTool() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  const strokesRef = useRef<any[]>([]);
  const redoRef = useRef<any[]>([]);
  const activeRef = useRef<any>(null);
  const sentRef = useRef(0);
  const broadcastRef = useRef(0);
  const remoteRef = useRef(new Map<string, any>());
  const linkRef = useRef<PeerLink | null>(null);
  const penRef = useRef({ mode: "pen", color: "#111111", width: 4 });

  const [mode, setMode] = useState("pen");
  const [color, setColor] = useState("#111111");
  const [width, setWidth] = useState("4");
  const [counts, setCounts] = useState({ strokes: 0, redo: 0 });
  const [pairing, setPairing] = useState(false);
  const [role, setRole] = useState("host");
  const [iceEnabled, setIceEnabled] = useState(false);
  const [iceText, setIceText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedCode, setPastedCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    penRef.current = { mode, color, width: Math.max(1, Math.min(64, Number(width) || 4)) };
  }, [mode, color, width]);

  const syncCounts = () => setCounts({ strokes: strokesRef.current.length, redo: redoRef.current.length });

  const repaint = () => {
    if (contextRef.current) renderBoard(contextRef.current, strokesRef.current, sizeRef.current);
  };

  // Backing store follows the CSS box times devicePixelRatio, so lines stay
  // crisp; a resize repaints from the stroke model, so nothing is lost.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const prepared = prepareCanvas(canvas, { width: rect.width, height: rect.height });
      contextRef.current = prepared.context;
      sizeRef.current = { width: prepared.width, height: prepared.height };
      renderBoard(prepared.context, strokesRef.current, sizeRef.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      contextRef.current = null;
    };
  }, []);

  const sendStroke = (stroke: any, final: boolean) => {
    const link = linkRef.current;
    if (!link?.isOpen()) {
      sentRef.current = stroke.points.length;
      return;
    }
    if (!final && stroke.points.length <= sentRef.current) return;
    try {
      link.sendFrame(encodeJsonFrame(FRAME_KIND.STROKE, serializeStrokeChunk(stroke, sentRef.current, final)));
      sentRef.current = stroke.points.length;
    } catch {
      // A peer that vanished must never interrupt local drawing.
    }
  };

  // Pointer Events cover mouse, trackpad, touch, and stylus (with pressure) in
  // one path. Registered once: live pen settings are read through penRef.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const down = (event: PointerEvent) => {
      const context = contextRef.current;
      if (!context || activeRef.current) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const pen = penRef.current;
      const stroke = createStroke({
        color: pen.color,
        width: pen.width / Math.max(1, sizeRef.current.width),
        erase: pen.mode === "eraser",
      });
      if (strokesRef.current.length >= MAX_STROKES) {
        setStatus({ tone: "error", message: `This board is full at ${MAX_STROKES} strokes. Export it, then clear the board to keep drawing.` });
        return;
      }
      addStrokePoint(stroke, pointFromEvent(canvas, event));
      activeRef.current = stroke;
      sentRef.current = 0;
      broadcastRef.current = 0;
      redoRef.current = [];
      strokesRef.current.push(stroke);
      drawStrokeSegment(context, stroke, sizeRef.current, 0);
      syncCounts();
    };

    const move = (event: PointerEvent) => {
      const stroke = activeRef.current;
      const context = contextRef.current;
      if (!stroke || !context) return;
      event.preventDefault();
      const from = Math.max(0, stroke.points.length - 1);
      const coalesced = event.getCoalescedEvents?.() || [];
      for (const sample of coalesced.length ? coalesced : [event]) addStrokePoint(stroke, pointFromEvent(canvas, sample));
      drawStrokeSegment(context, stroke, sizeRef.current, from);
      const now = Date.now();
      if (now - broadcastRef.current > 60) {
        broadcastRef.current = now;
        sendStroke(stroke, false);
      }
    };

    const up = () => {
      const stroke = activeRef.current;
      if (!stroke) return;
      sendStroke(stroke, true);
      activeRef.current = null;
      syncCounts();
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  useEffect(() => () => {
    linkRef.current?.close();
    linkRef.current = null;
  }, []);

  const handleFrame = (frame: PeerFrame) => {
    try {
      if (frame.kind === FRAME_KIND.STROKE) {
        const chunk = deserializeStrokeChunk(decodeJsonFrame(frame));
        // Namespace the peer's ids so a crafted id cannot reach a local stroke.
        chunk.stroke.id = `peer-${chunk.stroke.id}`;
        const existing = remoteRef.current.get(chunk.stroke.id) || null;
        if (!existing && strokesRef.current.length >= MAX_STROKES) throw new Error(`This board is full at ${MAX_STROKES} strokes, so new strokes from your peer are being ignored. Export and clear to carry on.`);
        const merged = mergeStrokeChunk(existing, chunk);
        const position = existing ? strokesRef.current.indexOf(existing) : -1;
        if (position >= 0) strokesRef.current[position] = merged.stroke;
        else strokesRef.current.push(merged.stroke);
        if (merged.final) remoteRef.current.delete(merged.stroke.id);
        else remoteRef.current.set(merged.stroke.id, merged.stroke);
        if (contextRef.current) drawStrokeSegment(contextRef.current, merged.stroke, sizeRef.current, merged.from);
        syncCounts();
        return;
      }
      if (frame.kind === FRAME_KIND.STROKE_UNDO) {
        const body = decodeJsonFrame(frame);
        const id = `peer-${String(body.i ?? "").slice(0, 64)}`;
        strokesRef.current = strokesRef.current.filter((stroke) => stroke.id !== id);
        remoteRef.current.delete(id);
        repaint();
        syncCounts();
        return;
      }
      if (frame.kind === FRAME_KIND.BOARD_CLEAR) {
        strokesRef.current = strokesRef.current.filter((stroke) => !stroke.remote);
        remoteRef.current.clear();
        repaint();
        syncCounts();
        setStatus({ tone: "idle", message: "Your peer cleared their strokes. Your own work is untouched." });
        return;
      }
      throw new Error("Your peer sent a message this tool does not use.");
    } catch (error: any) {
      setStatus({ tone: "error", message: error?.message || "Your peer sent something unexpected. Your own drawing is unaffected." });
    }
  };

  const openLink = () => {
    if (linkRef.current) throw new Error("A pairing is already set up here. Turn pairing off and on again to start over.");
    const link = createPeerLink({
      iceServersText: iceEnabled ? iceText : "",
      onFrame: handleFrame,
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false);
        setStatus({ tone: "idle", message: "Your peer disconnected. Everything already on your board stays, and you can keep drawing." });
      },
      onError: (error: any) => setStatus({ tone: "error", message: error?.message || "The peer connection reported a problem." }),
    });
    linkRef.current = link;
    return link;
  };

  const releaseLink = () => {
    linkRef.current?.close();
    linkRef.current = null;
    remoteRef.current.clear();
    setConnected(false);
  };

  const undo = () => runSafely(setStatus, async () => {
    for (let index = strokesRef.current.length - 1; index >= 0; index -= 1) {
      const stroke = strokesRef.current[index];
      if (stroke.remote) continue;
      strokesRef.current.splice(index, 1);
      redoRef.current.push(stroke);
      repaint();
      syncCounts();
      try {
        if (linkRef.current?.isOpen()) linkRef.current.sendFrame(encodeJsonFrame(FRAME_KIND.STROKE_UNDO, { i: stroke.id }));
      } catch {
        // Local undo already happened; the peer will fall out of sync at worst.
      }
      return "Undid your last stroke.";
    }
    throw new Error("There is nothing of yours left to undo.");
  });

  const redo = () => runSafely(setStatus, async () => {
    const stroke = redoRef.current.pop();
    if (!stroke) throw new Error("There is nothing to redo.");
    strokesRef.current.push(stroke);
    repaint();
    syncCounts();
    sentRef.current = 0;
    sendStroke(stroke, true);
    return "Redid a stroke.";
  });

  const clearBoard = () => runSafely(setStatus, async () => {
    if (!strokesRef.current.length) throw new Error("The board is already empty.");
    strokesRef.current = [];
    redoRef.current = [];
    remoteRef.current.clear();
    repaint();
    syncCounts();
    try {
      if (linkRef.current?.isOpen()) linkRef.current.sendFrame(encodeJsonFrame(FRAME_KIND.BOARD_CLEAR, {}));
    } catch {
      // Best effort: the local board is already clear.
    }
    return "Board cleared.";
  });

  const exportSize = () => {
    const scale = Math.min(3, Math.max(1, 1800 / Math.max(1, sizeRef.current.width)));
    return { width: Math.round(sizeRef.current.width * scale), height: Math.round(sizeRef.current.height * scale) };
  };

  const withExportCanvas = async (use: (canvas: HTMLCanvasElement) => Promise<void>) => {
    if (!strokesRef.current.length) throw new Error("Draw something before exporting.");
    const canvas = exportBoardCanvas(strokesRef.current, { ...exportSize(), background: "#ffffff" });
    try {
      await use(canvas);
    } finally {
      // Drop the offscreen pixels as soon as the export is encoded.
      canvas.width = 1;
      canvas.height = 1;
    }
  };

  const exportPng = () => runSafely(setStatus, async () => {
    await withExportCanvas(async (canvas) => {
      downloadBlob(await canvasToBlob(canvas, "image/png"), "myfilekit-whiteboard.png");
    });
    return "Whiteboard exported as PNG.";
  });

  const exportPdf = () => runSafely(setStatus, async () => {
    await withExportCanvas(async (canvas) => {
      downloadBytes(await canvasToPdf(canvas), "myfilekit-whiteboard.pdf", "application/pdf");
    });
    return "Whiteboard exported as PDF.";
  });

  const togglePairing = (next: boolean) => {
    if (!next) releaseLink();
    setPairing(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  const switchRole = (next: string) => {
    releaseLink();
    setRole(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  const createInvite = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so pairing is not available here. Solo drawing still works.");
    const code = await openLink().createInvite();
    setInviteCode(code);
    return "Invite code ready. Send it to your peer, then paste the answer code they send back.";
  });

  const acceptAnswer = () => runSafely(setStatus, async () => {
    const link = linkRef.current;
    if (!link) throw new Error("Create an invite code first.");
    await link.acceptAnswer(pastedCode);
    await waitForPeerOpen(link);
    return "Paired. New strokes from both sides now appear on both boards.";
  });

  const createAnswer = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so pairing is not available here. Solo drawing still works.");
    const code = await openLink().acceptInvite(pastedCode);
    setAnswerCode(code);
    return "Answer code ready. Send it back to whoever gave you the invite code.";
  });

  const reset = () => {
    releaseLink();
    strokesRef.current = [];
    redoRef.current = [];
    activeRef.current = null;
    repaint();
    syncCounts();
    setPairing(false);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div ref={wrapperRef} className="surface-card wabi-card-edge relative w-full overflow-hidden rounded-3xl border-dashed border-neutral-300" style={{ aspectRatio: "3 / 2" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Whiteboard drawing surface" />
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Tool" value={mode} onChange={setMode} options={["pen", "eraser"]} labels={["Pen", "Eraser"]} />
      <Input label="Colour" value={color} onChange={setColor} type="color" />
      <Input label="Thickness (px)" value={width} onChange={setWidth} type="number" helper="1 to 64. Stylus pressure varies it." />
    </div>

    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Undo" onClick={undo} />
      <SecondaryButton label="Redo" onClick={redo} />
      <SecondaryButton label="Clear board" onClick={clearBoard} />
      <PrimaryButton label="Download PNG" onClick={exportPng} />
      <SecondaryButton label="Download PDF" onClick={exportPdf} />
    </div>
    <p className="text-xs font-semibold text-neutral-500">{counts.strokes} stroke{counts.strokes === 1 ? "" : "s"} on the board · {counts.redo} available to redo</p>

    <Checkbox label="Draw with one peer (optional)" checked={pairing} onChange={togglePairing} />
    {pairing ? <>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Pairing opens the same direct connection the P2P File Share tool uses: you swap one code each, by hand, and strokes travel browser-to-browser. Works best on the same network. Your peer's strokes are drawn slightly lighter, and nothing you have already drawn is ever lost if they drop off.
      </div>
      <Select label="I am the" value={role} onChange={switchRole} options={["host", "guest"]} labels={["Host — I create the invite code", "Guest — I was given a code"]} />
      <IceServerPanel enabled={iceEnabled} setEnabled={setIceEnabled} value={iceText} onChange={setIceText} />
      {role === "host" ? <>
        {inviteCode
          ? <PeerCodeBox title="Step 1 · your invite code" hint="Send this whole code to your peer through a channel you already trust." code={inviteCode} onCopy={() => runSafely(setStatus, async () => { await copyText(inviteCode); return "Invite code copied."; })} />
          : <PrimaryButton label="Create invite code" onClick={createInvite} />}
        {inviteCode ? <>
          <Textarea label="Step 2 · paste your peer's answer code" value={pastedCode} onChange={setPastedCode} rows={4} />
          <PrimaryButton label="Connect" onClick={acceptAnswer} />
        </> : null}
      </> : <>
        <Textarea label="Step 1 · paste the invite code you were given" value={pastedCode} onChange={setPastedCode} rows={4} />
        {answerCode
          ? <PeerCodeBox title="Step 2 · your answer code" hint="Send this whole code back to the host. Drawing syncs as soon as they paste it." code={answerCode} onCopy={() => runSafely(setStatus, async () => { await copyText(answerCode); return "Answer code copied."; })} />
          : <PrimaryButton label="Create answer code" onClick={createAnswer} />}
      </>}
      <p className="text-xs font-bold uppercase text-neutral-500">{connected ? "Paired with peer" : "Not paired"}</p>
    </> : null}
  </ToolForm>;
}

// --- Business Tools -----------------------------------------------------------

export default function SharingTools({ tool }: { tool: Tool }) {
  if (tool.id === "p2p-share-tool") return <P2pShareTool tool={tool} />;
  if (tool.id === "collab-whiteboard-tool") return <WhiteboardTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
