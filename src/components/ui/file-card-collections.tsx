import { cn } from "@/lib/utils";
import { ReactNode } from "react";

/**
 * A small visual stand-in for a file, showing its type at a glance.
 *
 * Two deliberate departures from the source, both to keep it inside this app's
 * design system rather than fighting it:
 *
 * 1. The format banner used twenty arbitrary Tailwind colours (bg-red-500,
 *    bg-blue-500, …). This product spent a lot of effort getting to ONE accent
 *    with measured contrast; twenty decorative hues would undo that, and colour
 *    here carries no meaning a user acts on. The banner is neutral and the
 *    format is read from the label, which is what people actually read anyway.
 * 2. `rounded-md` (6px) became the 3px app radius. The system's stated
 *    invariant is 2-4px.
 *
 * The page-preview illustrations are kept as-is: they are the point of the
 * component, they use `--foreground` at low alpha so they theme correctly, and
 * they carry no colour of their own.
 */
type FormatFileProps =
  | "doc" | "pdf" | "md" | "mdx" | "csv" | "xls" | "xlsx" | "txt"
  | "ppt" | "pptx" | "zip" | "rar" | "tar" | "gz" | "code" | "html"
  | "js" | "jsx" | "tsx" | "css" | "json" | "img" | "png" | "jpg"
  | "jpeg" | "video";

type FileCardProps = {
  formatFile: FormatFileProps;
  /** Optional accessible name. The card is decorative unless this is given. */
  label?: string;
  className?: string;
};

const DefaultPlaceholder = () => (
  <div className="space-y-1.5">
    <div className="flex gap-2">
      <div className="bg-foreground/20 h-0.5 w-1/2 rounded-full" />
    </div>
    <div className="flex gap-1">
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
    </div>
    <div className="flex gap-1">
      <div className="bg-foreground/10 h-0.5 w-1/2 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
    </div>
    <div className="flex gap-1">
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
    </div>
    <div className="flex gap-1">
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-1/2 rounded-full" />
    </div>
    <div className="flex gap-1">
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
    </div>
  </div>
);

const TablePlaceholder = () => (
  <div className="space-y-0.5">
    <div className="grid grid-cols-3 gap-0.5">
      {Array.from({ length: 3 }, (_, i) => <div className="bg-foreground/20 h-2" key={i} />)}
    </div>
    <div className="grid grid-cols-3 gap-0.5">
      {Array.from({ length: 6 }, (_, i) => <div className="bg-foreground/5 h-2" key={i} />)}
    </div>
    <div className="grid grid-cols-3 gap-0.5">
      {Array.from({ length: 2 }, (_, i) => <div className="bg-foreground/5 h-2" key={i} />)}
    </div>
    <div className="grid grid-cols-3 gap-0.5">
      <div className="bg-foreground/5 h-2" />
    </div>
  </div>
);

const CsvPlaceholder = () => (
  <>
    <div className="mb-2 grid grid-cols-3 gap-0.5">
      {Array.from({ length: 3 }, (_, i) => <div className="bg-foreground/20 h-1.5 rounded-full" key={i} />)}
    </div>
    <div className="space-y-1.5">
      {[3, 3, 2, 1].map((cells, row) => (
        <div className="grid grid-cols-3 gap-0.5" key={row}>
          {Array.from({ length: cells }, (_, i) => <div className="bg-foreground/5 h-1 rounded-full" key={i} />)}
        </div>
      ))}
    </div>
  </>
);

const ArchivePlaceholder = () => (
  <div className="relative flex h-full flex-col items-center justify-center">
    <div>
      {Array.from({ length: 9 }, (_, i) => (
        <div className="flex overflow-hidden rounded-full" key={i}>
          <div className={i % 2 === 0 ? "bg-foreground/20 size-1.5" : "bg-foreground/5 size-1.5"} />
          <div className={i % 2 === 0 ? "bg-foreground/5 size-1.5" : "bg-foreground/20 size-1.5"} />
          {/* Both variants are written as complete strings so Tailwind's static
              extraction sees them; a class built by template literal is never
              generated. */}
        </div>
      ))}
    </div>
  </div>
);

const MarkdownPlaceholder = () => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1">
      <div className="text-foreground/30 text-[10px] font-bold">#</div>
      <div className="bg-foreground/20 h-0.5 w-6 rounded-full" />
    </div>
    <div className="space-y-1">
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-7 rounded-full" />
    </div>
    <div className="space-y-1">
      <div className="bg-foreground/10 h-0.5 w-8 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-4 rounded-full" />
      <div className="bg-foreground/10 h-0.5 w-1/3 rounded-full" />
    </div>
  </div>
);

/** A framed thumbnail: a slide, an image, or a video still. */
const FramedPlaceholder = ({ mark }: { mark: ReactNode }) => (
  <>
    <div className="bg-foreground/5 mb-1.5 space-y-1 rounded border p-1">
      <div className="flex justify-center gap-1">{mark}</div>
      <div className="bg-foreground/15 mx-auto mt-1 h-[3px] w-4 rounded-full" />
      <div className="bg-foreground/15 mx-auto h-[3px] w-8 rounded-full" />
    </div>
  </>
);

const CodePlaceholder = () => (
  <div className="space-y-1">
    <div className="flex items-center gap-0.5">
      <div className="text-foreground/30 font-mono text-[5px]">&lt;</div>
      <div className="bg-foreground/25 h-[3px] w-3 rounded-full" />
      <div className="text-foreground/30 font-mono text-[5px]">&gt;</div>
    </div>
    <div className="flex items-center gap-0.5 pl-1">
      <div className="text-foreground/30 font-mono text-[5px]">&lt;</div>
      <div className="bg-foreground/15 h-[3px] w-2.5 rounded-full" />
      <div className="text-foreground/30 font-mono text-[5px]">&gt;</div>
    </div>
    <div className="flex items-center gap-0.5 pl-1">
      <div className="text-foreground/30 font-mono text-[5px]">&lt;/</div>
      <div className="bg-foreground/15 h-[3px] w-2.5 rounded-full" />
      <div className="text-foreground/30 font-mono text-[5px]">&gt;</div>
    </div>
    <div className="flex items-center gap-0.5">
      <div className="text-foreground/30 font-mono text-[5px]">&lt;</div>
      <div className="bg-foreground/25 h-[3px] w-1 rounded-full" />
      <div className="text-foreground/30 font-mono text-[5px]">/&gt;</div>
    </div>
  </div>
);

/** Braced key/value shapes, for CSS and JSON. */
const BracedPlaceholder = () => (
  <div className="space-y-1">
    <div className="text-foreground/40 font-mono text-[6px]">{"{"}</div>
    <div className="flex items-center gap-1 pl-1.5">
      <div className="bg-foreground/20 h-[3px] w-3 rounded-full" />
      <div className="bg-foreground/20 h-[3px] w-4 rounded-full" />
    </div>
    <div className="flex items-center gap-1 pl-1.5">
      <div className="bg-foreground/10 h-[3px] w-4 rounded-full" />
      <div className="bg-foreground/10 h-[3px] w-2 rounded-full" />
    </div>
    <div className="flex items-center gap-1 pl-1.5">
      <div className="bg-foreground/10 h-[3px] w-3 rounded-full" />
      <div className="bg-foreground/10 h-[3px] w-4 rounded-full" />
    </div>
    <div className="text-foreground/40 font-mono text-[6px]">{"}"}</div>
  </div>
);

const PLACEHOLDERS: Partial<Record<FormatFileProps, ReactNode>> = {
  md: <MarkdownPlaceholder />,
  mdx: <MarkdownPlaceholder />,
  xls: <TablePlaceholder />,
  xlsx: <TablePlaceholder />,
  csv: <CsvPlaceholder />,
  zip: <ArchivePlaceholder />,
  rar: <ArchivePlaceholder />,
  tar: <ArchivePlaceholder />,
  gz: <ArchivePlaceholder />,
  ppt: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  pptx: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  img: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  png: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  jpg: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  jpeg: <FramedPlaceholder mark={<div className="bg-foreground/25 size-3 rounded-sm" />} />,
  video: <FramedPlaceholder mark={<div className="border-foreground/40 size-0 border-y-[5px] border-l-8 border-y-transparent" />} />,
  html: <CodePlaceholder />,
  js: <CodePlaceholder />,
  jsx: <CodePlaceholder />,
  tsx: <CodePlaceholder />,
  code: <CodePlaceholder />,
  css: <BracedPlaceholder />,
  json: <BracedPlaceholder />,
};

export const FileCard = ({ formatFile, label, className }: FileCardProps) => {
  const placeholder = PLACEHOLDERS[formatFile] ?? <DefaultPlaceholder />;
  const decorative = !label;

  return (
    <div
      className={cn("relative size-fit", className)}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={label}
    >
      <span className="border-border text-foreground/70 bg-card absolute -right-2 bottom-1.5 z-2 rounded-[3px] border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide">
        {formatFile}
      </span>
      <div className="dark:bg-secondary ring-border relative z-1 h-18 w-14 space-y-3 rounded-[3px] bg-white p-2 ring-1">
        {placeholder}
      </div>
    </div>
  );
};

export default FileCard;
