// Image tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useRef, useState } from "react";
import { zipSync } from "fflate";
import { formatBytes } from "../utils/format.js";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob, downloadText } from "../services/download.service.js";
import { addTextToImage, cleanImageMetadata, compressImage, cropImage, exportCanvas, imageDimensions, imageToCanvas, resizeImage, rotateFlipImage } from "../services/image.service.js";
import { inspectImageMetadata, metadataReportToJson } from "../services/metadata.service.js";
import { getHtml2Canvas } from "../services/capture.service.js";
import { initialStatus, ToolForm, StatusBox, FileControl, InfoRow, Input, Textarea, Select, Range, Checkbox, PrimaryButton, SecondaryButton, runSafely, canvasToBlob, imageExt } from "./shared";
import type { Tool } from "./shared";


const IMAGE_FORMATS = ["image/jpeg", "image/png", "image/webp"];
const KEEPS_ALPHA = new Set(["image/png", "image/webp"]);

/**
 * Follow the source file's own format instead of hard-defaulting to JPEG.
 *
 * The default used to be JPEG for every source. Drop in a PNG logo with a
 * transparent background, press the only button, and the formerly transparent
 * pixels came back opaque white — measured [255,255,255,255] — under a silently
 * changed .jpg extension, for a 0.7% size saving. Nothing said so.
 */
function useSourceFormat(files: File[], setFormat: (value: string) => void) {
  const seen = useRef("");
  useEffect(() => {
    const type = files[0]?.type || "";
    if (!type || type === seen.current) return;
    seen.current = type;
    if (IMAGE_FORMATS.includes(type)) setFormat(type);
  }, [files, setFormat]);
}

/** Warns before a lossy target silently flattens a transparent source. */
function AlphaWarning({ files, format }: { files: File[]; format: string }) {
  const source = files[0]?.type || "";
  if (!source || KEEPS_ALPHA.has(format) || !KEEPS_ALPHA.has(source)) return null;
  return (
    <p className="text-xs font-semibold" style={{ color: "#9a5b08" }}>
      JPEG cannot store transparency. Any transparent area in this image will become solid white.
      Choose PNG or WebP to keep it.
    </p>
  );
}

function ImageOutputTool({ tool, mode }: { tool: Tool; mode: "compress" | "convert" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState("image/jpeg");
  const [quality, setQuality] = useState("0.82");
  const [status, setStatus] = useState(initialStatus);
  useSourceFormat(files, setFormat);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    <AlphaWarning files={files} format={format} />
    {mode === "compress" && format !== "image/png" && <Range label="Quality" value={quality} onChange={setQuality} />}
    {mode === "compress" && format === "image/png" && (
      <p className="text-xs font-semibold text-neutral-500">PNG is lossless, so the quality setting does not apply. Choose JPEG or WebP to trade quality for a smaller file.</p>
    )}
    <PrimaryButton label={mode === "compress" ? "Compress image" : "Convert image"} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const blob = mode === "compress"
        ? await compressImage(file, format, Number(quality))
        : await exportCanvas(await imageToCanvas(file), format, 0.92);
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-${mode}`, imageExt(format)));
      const grew = mode === "compress" && blob.size >= file.size;
      return `Original: ${formatBytes(file.size)}\nOutput: ${formatBytes(blob.size)}${grew ? "\nNote: the output is not smaller than the original. The source may already be optimized — try JPEG or WebP output." : ""}`;
    })} />
  </ToolForm>;
}

function BatchImageTool({ tool, mode }: { tool: Tool; mode: "compress" | "resize" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("0.82");
  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [preserve, setPreserve] = useState(true);
  const [format, setFormat] = useState("image/jpeg");
  const [status, setStatus] = useState(initialStatus);
  useSourceFormat(files, setFormat);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    <AlphaWarning files={files} format={format} />
    {mode === "compress" ? <Range label="Quality" value={quality} onChange={setQuality} /> : (
      <>
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Height" value={height} onChange={setHeight} type="number" /></div>
        <Checkbox label="Preserve aspect ratio" checked={preserve} onChange={setPreserve} />
      </>
    )}
    <PrimaryButton label={mode === "compress" ? "Compress batch" : "Resize batch"} onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      let totalBefore = 0;
      let totalAfter = 0;
      const outputs: Record<string, Uint8Array> = {};
      for (const [index, file] of valid.entries()) {
        totalBefore += file.size;
        const blob = mode === "compress"
          ? await compressImage(file, format, Number(quality))
          : await exportCanvas(await resizeImage(file, Number(width), Number(height), preserve), format, 0.88);
        totalAfter += blob.size;
        const filename = withExtension(`${String(index + 1).padStart(2, "0")}-${safeFilename(file.name)}-${mode}`, imageExt(format));
        outputs[filename] = new Uint8Array(await blob.arrayBuffer());
      }
      const zipped = zipSync(outputs, { level: 0 });
      const zipBuffer = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(zipBuffer).set(zipped);
      downloadBlob(new Blob([zipBuffer], { type: "application/zip" }), `myfilekit-${mode}-images.zip`);
      return `Processed ${valid.length} image${valid.length === 1 ? "" : "s"} into one ZIP file.\nBefore: ${formatBytes(totalBefore)}\nAfter: ${formatBytes(totalAfter)}`;
    })} />
  </ToolForm>;
}

function ResizeImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [format, setFormat] = useState("image/jpeg");
  const [preserve, setPreserve] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  useSourceFormat(files, setFormat);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Height" value={height} onChange={setHeight} type="number" /></div>
    <Checkbox label="Preserve aspect ratio" checked={preserve} onChange={setPreserve} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    <AlphaWarning files={files} format={format} />
    <PrimaryButton label="Resize image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await resizeImage(file, Number(width), Number(height), preserve);
      const blob = await exportCanvas(canvas, format, 0.88);
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-resized`, imageExt(format)));
      return `Output: ${canvas.width}×${canvas.height}, ${formatBytes(blob.size)}`;
    })} />
  </ToolForm>;
}

function CropImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [values, setValues] = useState({ x: "0", y: "0", width: "500", height: "500" });
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <div className="grid gap-3 sm:grid-cols-4">{(["x", "y", "width", "height"] as const).map((key) => <Input key={key} label={key.toUpperCase()} value={values[key]} onChange={(value) => setValues({ ...values, [key]: value })} type="number" />)}</div>
    <PrimaryButton label="Crop image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await cropImage(file, values.x, values.y, values.width, values.height);
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-cropped`, "png"));
      return `Cropped to ${canvas.width}×${canvas.height}.`;
    })} />
  </ToolForm>;
}

function RotateFlipImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [rotation, setRotation] = useState("90");
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Select label="Rotation" value={rotation} onChange={setRotation} options={["90", "180", "270"]} />
    <div className="grid gap-2 sm:grid-cols-2"><Checkbox label="Flip horizontal" checked={flipX} onChange={setFlipX} /><Checkbox label="Flip vertical" checked={flipY} onChange={setFlipY} /></div>
    <PrimaryButton label="Export image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await rotateFlipImage(file, rotation, flipX, flipY);
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-rotated`, "png"));
      return `Output: ${canvas.width}×${canvas.height}.`;
    })} />
  </ToolForm>;
}

function AddTextToImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("MyFileKit");
  const [x, setX] = useState("40");
  const [y, setY] = useState("80");
  const [size, setSize] = useState("48");
  const [color, setColor] = useState("#111827");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This overlays new text onto the image pixels. It does not OCR or replace existing text already baked into a PNG.
    </div>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Input label="Text" value={text} onChange={setText} />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Size" value={size} onChange={setSize} type="number" /><Input label="Color" value={color} onChange={setColor} type="color" /></div>
    <PrimaryButton label="Add text to image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await addTextToImage(file, { text, x: Number(x), y: Number(y), size: Number(size), color });
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-text-added`, "png"));
      return `Text added to ${file.name}.`;
    })} />
  </ToolForm>;
}

type MetadataImageInfo = {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  lastModified: number;
};

type MetadataReport = {
  format: string;
  metadataCount: number;
  containers: Array<{ type: string; detail: string; removable: boolean }>;
  groups: Array<{ title: string; items: Array<{ label: string; value: string; sensitive?: boolean }> }>;
  privacy: Record<string, boolean>;
  warnings: string[];
};

function ImageMetadataInspectorTool({ tool }: { tool: Tool }) {
  return <ImageMetadataTool tool={tool} canClean={false} />;
}

function ImageMetadataTool({ tool, canClean }: { tool: Tool; canClean: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<MetadataImageInfo | null>(null);
  const [report, setReport] = useState<MetadataReport | null>(null);
  const [cleaned, setCleaned] = useState<{ blob: Blob; filename: string } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setInfo(null);
    setReport(null);
    setCleaned(null);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setCleaned(null);
    setInfo(null);
    setReport(null);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [dimensions, metadata] = await Promise.all([imageDimensions(file), inspectImageMetadata(file)]);
      if (cancelled) return "Ready.";
      setInfo({
        name: file.name,
        type: file.type || "Unknown image type",
        size: file.size,
        width: dimensions.width,
        height: dimensions.height,
        lastModified: file.lastModified,
      });
      setReport(metadata);
      return metadata.metadataCount
        ? `Found ${metadata.metadataCount} metadata detail${metadata.metadataCount === 1 ? "" : "s"} locally. Review and clean when ready.`
        : "Image validated locally. No embedded metadata was detected by the local parser.";
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const clean = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    const outputType = file.type || "image/png";
    const blob = await cleanImageMetadata(file, outputType);
    const filename = withExtension(`${safeFilename(file.name)}-cleaned`, imageExt(outputType));
    setCleaned({ blob, filename });
    return "The cleaned image is re-encoded locally in your browser. Most embedded metadata is removed, but browser-based cleaning may not preserve every original encoding detail.";
  });

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        {canClean
          ? "Full local image metadata workflow for JPG/JPEG, PNG, and WebP: inspect EXIF/XMP/ICC/IPTC-style containers where present, review sensitive fields like GPS, then re-encode a cleaned copy in your browser."
          : "Read EXIF, XMP, ICC, GPS, and container metadata from JPG/JPEG, PNG, and WebP images locally. This inspector does not upload, alter, or store your file."}
      </div>
      <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Detected file info</p>
          {info ? (
            <dl className="mt-3 grid gap-2 text-sm font-semibold text-neutral-600">
              <InfoRow label="File name" value={info.name} />
              <InfoRow label="File type" value={info.type} />
              <InfoRow label="File size" value={formatBytes(info.size)} />
              <InfoRow label="Dimensions" value={`${info.width}×${info.height}px`} />
              <InfoRow label="Last modified" value={info.lastModified ? new Date(info.lastModified).toLocaleString() : "Not available"} />
            </dl>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Choose a supported image to inspect basic browser file info.</p>
          )}
        </div>
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Privacy scan</p>
          {report ? (
            <div className="mt-3 grid gap-3 text-sm font-semibold text-neutral-600">
              <InfoRow label="Container" value={report.format} />
              <InfoRow label="Metadata details" value={String(report.metadataCount)} />
              <InfoRow label="GPS/location" value={report.privacy.hasGps ? "Detected" : "Not detected"} />
              <InfoRow label="Camera/device" value={report.privacy.hasCamera ? "Detected" : "Not detected"} />
              <InfoRow label="XMP" value={report.privacy.hasXmp ? "Detected" : "Not detected"} />
              <InfoRow label="ICC profile" value={report.privacy.hasIccProfile ? "Detected" : "Not detected"} />
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Metadata scan results will appear here after upload.</p>
          )}
        </div>
      </div>
      {report && (
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-black">Detected metadata</p>
            <SecondaryButton label="Download JSON report" onClick={() => downloadText(metadataReportToJson(report), "metadata-report", "json", "application/json;charset=utf-8")} />
          </div>
          {report.warnings.length > 0 && (
            <div className="surface-muted wabi-card-edge p-3 text-sm font-semibold leading-6 text-neutral-600">
              {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
          {report.containers.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {report.containers.map((container, index) => (
                <div key={`${container.type}-${index}`} className="surface-muted wabi-card-edge p-3 text-sm font-semibold text-neutral-600">
                  <p className="font-black text-[var(--ink)]">{container.type}</p>
                  <p className="mt-1">{container.detail}</p>
                </div>
              ))}
            </div>
          )}
          {report.groups.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {report.groups.map((group) => (
                <div key={group.title} className="surface-muted wabi-card-edge p-4">
                  <p className="font-black capitalize">{group.title}</p>
                  <dl className="mt-3 grid gap-2 text-sm font-semibold text-neutral-600">
                    {group.items.map((item, index) => (
                      <InfoRow key={`${item.label}-${index}`} label={item.sensitive ? `${item.label} ⚠` : item.label} value={String(item.value)} />
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-neutral-500">No readable embedded metadata fields were detected.</p>
          )}
        </div>
      )}
      {canClean && (
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Cleaned result</p>
          {cleaned && info ? (
              <div className="mt-3 grid gap-3 text-sm font-semibold text-neutral-600">
                <InfoRow label="Before" value={formatBytes(info.size)} />
                <InfoRow label="After" value={formatBytes(cleaned.blob.size)} />
                <InfoRow label="Output" value={cleaned.filename} />
                <SecondaryButton label="Download cleaned image" onClick={() => downloadBlob(cleaned.blob, cleaned.filename)} />
              </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Cleaned image details will appear here after processing.</p>
          )}
        </div>
      )}
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Privacy note: the selected image and metadata report are processed locally in this browser session. MyFileKit does not upload it, store it, track it, or log metadata contents.
      </div>
      {canClean && <PrimaryButton label="Clean metadata and re-encode image" onClick={clean} />}
    </ToolForm>
  );
}

const equationExamples = ["E = mc^2", "\\frac{a}{b}", "\\sqrt{x^2 + y^2}", "\\sum_{i=1}^{n} i", "\\int_0^\\infty e^{-x}\\,dx"];

function EquationToImageTool() {
  const [latex, setLatex] = useState("E = mc^2");
  const [format, setFormat] = useState("png");
  const [transparent, setTransparent] = useState(true);
  const [scale, setScale] = useState("4");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const mathRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = mathRef.current;
    if (!element) return;
    let cancelled = false;
    // katex + its stylesheet load with this tool, not with the app.
    (async () => {
      try {
        const [{ default: katex }] = await Promise.all([
          import("katex"),
          import("katex/dist/katex.min.css"),
        ]);
        if (cancelled) return;
        katex.render(latex.trim() || "\\,", element, { throwOnError: true, displayMode: true });
        setError("");
      } catch (renderError: any) {
        if (!cancelled) setError(renderError?.message || "Invalid LaTeX.");
      }
    })();
    return () => { cancelled = true; };
  }, [latex]);

  return <ToolForm status={status} onReset={() => { setLatex(""); setError(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Renders LaTeX with KaTeX entirely in your browser — fonts are bundled locally, so nothing is fetched from the network.
    </div>
    <Textarea label="LaTeX equation" value={latex} onChange={setLatex} rows={4} />
    <div className="flex flex-wrap gap-2">
      {equationExamples.map((example) => (
        <button key={example} type="button" className="quick-chip" onClick={() => setLatex(example)}>{example}</button>
      ))}
    </div>
    <div className="surface-card wabi-card-edge grid min-h-28 place-items-center overflow-x-auto p-6">
      <div ref={mathRef} />
    </div>
    {error && <StatusBox status={{ tone: "error", message: `Invalid LaTeX: ${error}` }} />}
    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Format" value={format} onChange={setFormat} options={["png", "jpg"]} labels={["PNG", "JPG"]} />
      <Select label="Scale" value={scale} onChange={setScale} options={["2", "4", "6"]} labels={["2× · standard", "4× · sharp", "6× · large"]} />
      {format === "png" && <Checkbox label="Transparent background" checked={transparent} onChange={setTransparent} />}
    </div>
    <PrimaryButton label="Download image" onClick={() => runSafely(setStatus, async () => {
      if (!latex.trim()) throw new Error("Enter a LaTeX equation first.");
      if (error) throw new Error(`Invalid LaTeX: ${error}`);
      const element = mathRef.current;
      if (!element) throw new Error("The equation preview is not ready yet.");
      const html2canvas = getHtml2Canvas();
      await document.fonts?.ready?.catch(() => {});
      const type = format === "png" ? "image/png" : "image/jpeg";
      const useTransparent = format === "png" && transparent;
      const canvas = await html2canvas(element, {
        backgroundColor: useTransparent ? null : "#ffffff",
        scale: Number(scale),
        logging: false,
      });
      downloadBlob(await canvasToBlob(canvas, type), withExtension("myfilekit-equation", format));
      return `Equation image ready as ${format.toUpperCase()}.`;
    })} />
  </ToolForm>;
}

export default function ImageTools({ tool }: { tool: Tool }) {
  if (["compress-image-tool", "convert-image-tool"].includes(tool.id)) return <ImageOutputTool tool={tool} mode={tool.id === "compress-image-tool" ? "compress" : "convert"} />;
  if (tool.id === "batch-compress-images-tool") return <BatchImageTool tool={tool} mode="compress" />;
  if (tool.id === "batch-resize-images-tool") return <BatchImageTool tool={tool} mode="resize" />;
  if (tool.id === "resize-image-tool") return <ResizeImageTool tool={tool} />;
  if (tool.id === "crop-image-tool") return <CropImageTool tool={tool} />;
  if (tool.id === "rotate-flip-image-tool") return <RotateFlipImageTool tool={tool} />;
  if (tool.id === "add-text-to-image-tool") return <AddTextToImageTool tool={tool} />;
  if (tool.id === "image-metadata-inspector-tool") return <ImageMetadataInspectorTool tool={tool} />;
  if (tool.id === "equation-to-image-tool") return <EquationToImageTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}

export { ImageMetadataTool };
export type { MetadataImageInfo, MetadataReport };
