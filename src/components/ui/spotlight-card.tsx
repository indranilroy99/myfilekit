import { type CSSProperties, type PointerEvent, type ReactNode } from "react";

// A card with a subtle pointer-following spotlight glow, built to MyFileKit's
// design rules — deliberately NOT the generic library component:
//  - Single accent hue only (var(--primary)); no cursor-driven rainbow sweep.
//  - The pointer handler is scoped to THIS element (React onPointerMove), so it
//    fires only while the card is hovered — not a document-level listener per
//    card (which was a real perf smell in the old version).
//  - Styling lives in a scoped `.spotlight-card` CSS class in styles.css, so it
//    injects no markup at all (the app forbids runtime HTML injection).
//  - Honours prefers-reduced-motion via the CSS.
// The glow position is passed as local percentages (--sx/--sy) that the CSS
// turns into a radial-gradient in the accent colour.

type SpotlightCardProps = {
  children: ReactNode;
  className?: string;
  href?: string;
  ariaLabel?: string;
};

type SpotlightStyle = CSSProperties & Record<`--${string}`, string>;

export function SpotlightCard({ children, className = "", href, ariaLabel }: SpotlightCardProps) {
  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--sx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--sy", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  };

  const style: SpotlightStyle = { "--sx": "50%", "--sy": "0%" };
  const classes = `spotlight-card ${className}`.trim();

  if (href) {
    return (
      <a href={href} aria-label={ariaLabel} className={classes} style={style} onPointerMove={handlePointerMove}>
        {children}
      </a>
    );
  }
  return (
    <div className={classes} style={style} onPointerMove={handlePointerMove}>
      {children}
    </div>
  );
}
