// Signature tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useRef, useState } from "react";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob } from "../services/download.service.js";
import { addSignatureToImage, exportCanvas } from "../services/image.service.js";
import { initialStatus, ToolForm, StatusBox, FileControl, Input, Select, PrimaryButton, runSafely, canvasToBlob } from "./shared";
import type { Tool } from "./shared";

function AddSignatureToImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [signatures, setSignatures] = useState<File[]>([]);
  const [x, setX] = useState("40");
  const [y, setY] = useState("40");
  const [width, setWidth] = useState("280");
  const [opacity, setOpacity] = useState("1");
  const [status, setStatus] = useState(initialStatus);
  const imageOptions = { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] };
  return <ToolForm status={status} onReset={() => { setFiles([]); setSignatures([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} label="Choose base image" />
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} label="Choose signature image" />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Opacity" value={opacity} onChange={setOpacity} type="number" /></div>
    <PrimaryButton label="Add signature to image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [signature] = validateFiles(signatures, imageOptions);
      const canvas = await addSignatureToImage(file, signature, { x: Number(x), y: Number(y), width: Number(width), opacity: Number(opacity) });
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-signed`, "png"));
      return `Signature added to ${file.name}.`;
    })} />
  </ToolForm>;
}

function DrawSignatureTool() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasInkRef = useRef(false);
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState("4");
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let drawing = false;
    const pointFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const start = (event: PointerEvent) => {
      event.preventDefault();
      drawing = true;
      hasInkRef.current = true;
      canvas.setPointerCapture?.(event.pointerId);
      const { x, y } = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const draw = (event: PointerEvent) => {
      if (!drawing) return;
      event.preventDefault();
      const { x, y } = pointFromEvent(event);
      ctx.strokeStyle = color;
      ctx.lineWidth = Number(size);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const stop = () => { drawing = false; };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
    window.addEventListener("pointerup", stop);
    return () => {
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("pointerleave", stop);
      window.removeEventListener("pointerup", stop);
    };
  }, [color, size]);

  return <ToolForm status={status} onReset={() => { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 900, 260); hasInkRef.current = false; setStatus(initialStatus); }}>
    <canvas ref={canvasRef} className="surface-card h-auto min-h-44 w-full touch-none rounded-3xl border-dashed border-neutral-400" width={900} height={260} />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Color" value={color} onChange={setColor} type="color" /><Input label="Thickness" value={size} onChange={setSize} type="number" /></div>
    <PrimaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => {
      if (!hasInkRef.current || !canvasRef.current) throw new Error("Draw a signature before downloading.");
      downloadBlob(await canvasToBlob(canvasRef.current, "image/png"), "signature.png");
      return "Signature ready to download.";
    })} />
  </ToolForm>;
}

function TypeSignatureTool() {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("cursive");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setName(""); setStatus(initialStatus); }}>
    <Input label="Name" value={name} onChange={setName} placeholder="Type your name" />
    <Select label="Style" value={style} onChange={setStyle} options={["cursive", "serif", "monospace"]} labels={["Cursive", "Serif", "Monospace"]} />
    <PrimaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => {
      if (!name.trim()) throw new Error("Enter a name before downloading a signature.");
      const canvas = document.createElement("canvas");
      canvas.width = 900; canvas.height = 260;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot create a signature image.");
      ctx.font = `72px ${style}`;
      ctx.fillText(name.trim(), 40, 145);
      downloadBlob(await canvasToBlob(canvas, "image/png"), "typed-signature.png");
      return "Signature ready to download.";
    })} />
  </ToolForm>;
}

export default function SignatureTools({ tool }: { tool: Tool }) {
  if (tool.id === "add-signature-to-image-tool") return <AddSignatureToImageTool tool={tool} />;
  if (tool.id === "draw-signature-tool") return <DrawSignatureTool />;
  if (tool.id === "type-signature-tool") return <TypeSignatureTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
