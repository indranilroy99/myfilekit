export function AnimatedLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"} aria-hidden="true">
      <span className="brand-mark-aura" />
      <svg className="brand-logo-svg" viewBox="0 0 96 96" focusable="false">
        <defs>
          <linearGradient id="mfk-paper" x1="19" y1="8" x2="77" y2="88" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#eaf2ff" />
          </linearGradient>
          <linearGradient id="mfk-ink" x1="28" y1="20" x2="76" y2="82" gradientUnits="userSpaceOnUse">
            <stop stopColor="#102033" />
            <stop offset="1" stopColor="#1d4ed8" />
          </linearGradient>
          <linearGradient id="mfk-earth" x1="23" y1="17" x2="71" y2="85" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1d4ed8" />
            <stop offset=".58" stopColor="#0ea5a4" />
            <stop offset="1" stopColor="#0f766e" />
          </linearGradient>
        </defs>
        <path className="brand-logo-ring" d="M48 7c21.8 0 39.5 17.7 39.5 39.5 0 18.6-12.9 34.2-30.2 38.4" />
        <path className="brand-logo-ring brand-logo-ring-gap" d="M34.6 83.7C19.4 78.2 8.5 63.6 8.5 46.5c0-11.8 5.2-22.4 13.4-29.6" />
        <path className="brand-logo-sheet brand-logo-sheet-back" d="M24 18.5h34.5L76 36v39.5H24z" />
        <path className="brand-logo-sheet brand-logo-sheet-front" d="M18.5 13h38.8L78.5 34.2V81h-60z" />
        <path className="brand-logo-fold" d="M57.3 13v21.2h21.2z" />
        <path className="brand-logo-mark" d="M33 64V35l15 18 15-18v29" />
        <path className="brand-logo-line" d="M34 72h30" />
        <circle className="brand-logo-dot" cx="69" cy="68" r="3.5" />
      </svg>
    </span>
  );
}
