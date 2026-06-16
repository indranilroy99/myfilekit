import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";
import type { ComponentProps, SVGProps } from "react";

type FeatureType = {
  title: string;
  icon: LucideIcon;
  description: string;
};

type FeatureCardProps = ComponentProps<"div"> & {
  feature: FeatureType;
};

export function FeatureCard({ feature, className, ...props }: FeatureCardProps) {
  const pattern = patternFromTitle(feature.title);
  const reactId = useId();
  const patternId = `feature-card-grid-${reactId.replace(/:/g, "")}`;
  const Icon = feature.icon;

  return (
    <div className={cn("feature-pattern-card group relative overflow-hidden", className)} {...props}>
      <GridPattern
        id={patternId}
        squares={pattern}
        className="pointer-events-none absolute inset-x-0 -top-16 h-40 w-full skew-y-6 stroke-current text-slate-900/10 [mask-image:linear-gradient(-75deg,rgba(0,0,0,.45),rgba(0,0,0,.08),transparent)]"
      />
      <div className="feature-pattern-glow" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col gap-5">
        <span className="feature-pattern-icon" aria-hidden="true">
          <Icon size={21} strokeWidth={2.2} />
        </span>
        <div className="mt-auto">
          <h3 className="text-base font-black text-slate-950">{feature.title}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{feature.description}</p>
        </div>
      </div>
    </div>
  );
}

function GridPattern({
  width = 8,
  height = 8,
  x = -1,
  y = -1,
  squares,
  id,
  ...props
}: SVGProps<SVGSVGElement> & {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  squares?: number[][];
  id: string;
}) {
  return (
    <svg aria-hidden="true" {...props}>
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares?.map(([squareX, squareY], index) => (
        <rect
          key={`${squareX}-${squareY}-${index}`}
          width={width + 1}
          height={height + 1}
          x={squareX * width}
          y={squareY * height}
          fill="currentColor"
          strokeWidth="0"
          className="text-slate-900/10"
        />
      ))}
    </svg>
  );
}

function patternFromTitle(title: string, length = 5): number[][] {
  const seed = Array.from(title).reduce((total, char) => total + char.charCodeAt(0), 0);

  return Array.from({ length }, (_, index) => {
    const value = seed + index * 37;
    return [(value % 5) + 7, (Math.floor(value / 7) % 6) + 1];
  });
}
