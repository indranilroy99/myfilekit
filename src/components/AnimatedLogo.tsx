export function AnimatedLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"} aria-hidden="true">
      <span className="brand-mark-aura" />
      <svg className="brand-logo-svg" viewBox="0 0 96 96" focusable="false">
        <defs>
          <linearGradient id="mfk-tile" x1="15" y1="9" x2="83" y2="88" gradientUnits="userSpaceOnUse">
            <stop stopColor="#111827" />
            <stop offset="1" stopColor="#344054" />
          </linearGradient>
          <linearGradient id="mfk-sheet" x1="25" y1="19" x2="73" y2="78" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#eef2f7" />
          </linearGradient>
          <linearGradient id="mfk-line" x1="31" y1="31" x2="67" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#101828" />
            <stop offset="1" stopColor="#475467" />
          </linearGradient>
        </defs>
        <rect x="11" y="11" width="74" height="74" rx="22" fill="url(#mfk-tile)" />
        <rect x="18" y="18" width="60" height="60" rx="18" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="2" />
        <path d="M31 23h25.5L69 35.5V72H31z" fill="url(#mfk-sheet)" />
        <path d="M56.5 23v12.5H69" fill="#d9e1ec" />
        <path d="M31 23h25.5L69 35.5V72H31z" fill="none" stroke="rgba(16,24,40,.22)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M39 58V39l9.2 11.4L57.5 39v19" fill="none" stroke="url(#mfk-line)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M39 65h20" stroke="url(#mfk-line)" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="65.5" cy="63.5" r="3.5" fill="#101828" />
      </svg>
    </span>
  );
}
