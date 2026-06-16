import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

export type GlowColor = "blue" | "purple" | "green" | "red" | "orange";
type GlowSize = "sm" | "md" | "lg";

type GlowCardProps = {
  children?: ReactNode;
  className?: string;
  glowColor?: GlowColor;
  size?: GlowSize;
  width?: string | number;
  height?: string | number;
  customSize?: boolean;
};

const glowColorMap: Record<GlowColor, { base: number; spread: number }> = {
  blue: { base: 220, spread: 200 },
  purple: { base: 280, spread: 300 },
  green: { base: 120, spread: 200 },
  red: { base: 0, spread: 200 },
  orange: { base: 30, spread: 200 },
};

const sizeMap: Record<GlowSize, string> = {
  sm: "h-64 w-48",
  md: "h-80 w-64",
  lg: "h-96 w-80",
};

type GlowStyle = CSSProperties & Record<`--${string}`, string | number>;

export function GlowCard({
  children,
  className = "",
  glowColor = "blue",
  size = "md",
  width,
  height,
  customSize = false,
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncPointer = (event: PointerEvent) => {
      const card = cardRef.current;
      if (!card) return;

      card.style.setProperty("--x", event.clientX.toFixed(2));
      card.style.setProperty("--xp", (event.clientX / window.innerWidth).toFixed(2));
      card.style.setProperty("--y", event.clientY.toFixed(2));
      card.style.setProperty("--yp", (event.clientY / window.innerHeight).toFixed(2));
    };

    document.addEventListener("pointermove", syncPointer, { passive: true });
    return () => document.removeEventListener("pointermove", syncPointer);
  }, []);

  const { base, spread } = glowColorMap[glowColor];
  const style: GlowStyle = {
    "--base": base,
    "--spread": spread,
    "--radius": "22",
    "--border": "1.5",
    "--backdrop": "hsl(0 0% 100% / 0.72)",
    "--backup-border": "hsl(215 24% 18% / 0.08)",
    "--size": "180",
    "--outer": "1",
    "--border-size": "calc(var(--border, 2) * 1px)",
    "--spotlight-size": "calc(var(--size, 150) * 1px)",
    "--hue": "calc(var(--base) + (var(--xp, 0) * var(--spread, 0)))",
    backgroundColor: "var(--backdrop, transparent)",
    backgroundImage: `radial-gradient(
      var(--spotlight-size) var(--spotlight-size) at
      calc(var(--x, 0) * 1px)
      calc(var(--y, 0) * 1px),
      hsl(var(--hue, 210) 90% 64% / 0.08),
      transparent
    )`,
    backgroundAttachment: "fixed",
    backgroundPosition: "50% 50%",
    backgroundSize: "calc(100% + (2 * var(--border-size))) calc(100% + (2 * var(--border-size)))",
    border: "var(--border-size) solid var(--backup-border)",
    position: "relative",
  };

  if (width !== undefined) {
    style.width = typeof width === "number" ? `${width}px` : width;
  }
  if (height !== undefined) {
    style.height = typeof height === "number" ? `${height}px` : height;
  }

  return (
    <div
      ref={cardRef}
      data-glow-card
      style={style}
      className={`
        ${customSize ? "" : sizeMap[size]}
        ${customSize ? "" : "aspect-[3/4]"}
        relative grid grid-rows-[1fr_auto] gap-4 overflow-hidden rounded-2xl p-4 shadow-[0_1rem_2rem_-1rem_rgba(0,0,0,0.45)] backdrop-blur-[5px]
        ${className}
      `}
    >
      <div className="glow-card-inner" aria-hidden="true" />
      {children}
    </div>
  );
}
