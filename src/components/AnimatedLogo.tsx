import { useId } from "react";

export function AnimatedLogo({ compact = false }: { compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const tile = `mfk-tile-${id}`;
  const folder = `mfk-folder-${id}`;
  const paper = `mfk-paper-${id}`;
  const accent = `mfk-accent-${id}`;

  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"} aria-hidden="true">
      <span className="brand-mark-aura" />
      <svg className="brand-logo-svg" viewBox="0 0 96 96" focusable="false">
        <defs>
          <linearGradient id={tile} x1="12" y1="10" x2="86" y2="88" gradientUnits="userSpaceOnUse">
            <stop stopColor="#101828" />
            <stop offset="1" stopColor="#29384f" />
          </linearGradient>
          <linearGradient id={folder} x1="16" y1="40" x2="80" y2="76" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0f7fbd" />
            <stop offset="1" stopColor="#075f99" />
          </linearGradient>
          <linearGradient id={paper} x1="34" y1="18" x2="67" y2="61" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#e8eef7" />
          </linearGradient>
          <linearGradient id={accent} x1="39" y1="29" x2="75" y2="74" gradientUnits="userSpaceOnUse">
            <stop stopColor="#51c878" />
            <stop offset="1" stopColor="#12975b" />
          </linearGradient>
        </defs>
        <rect className="brand-logo-tile" x="8" y="8" width="80" height="80" rx="22" fill={`url(#${tile})`} />
        <path className="brand-logo-back-file" d="M28 24h30l12 12v31H28z" fill="#dce8f5" />
        <path className="brand-logo-back-fold" d="M58 24v12h12z" fill="#b9cbe0" />
        <path className="brand-logo-paper" d="M34 18h31l13 13v40H34z" fill={`url(#${paper})`} />
        <path className="brand-logo-fold" d="M65 18v13h13z" fill="#d5e1ee" />
        <path className="brand-logo-folder-tab" d="M17 39h24l6 7h32v7H17z" fill="#0b6ea8" />
        <path className="brand-logo-folder" d="M16 46h64l-5 29H21z" fill={`url(#${folder})`} />
        <path className="brand-logo-folder-lip" d="M20 50h56" />
        <path className="brand-logo-check" d="M32 61l10 10 24-27" />
        <path className="brand-logo-paper-line" d="M43 35h19M43 44h24M43 53h14" />
        <circle className="brand-logo-dot" cx="71" cy="67" r="4" fill={`url(#${accent})`} />
      </svg>
    </span>
  );
}
