import { FileStack } from "lucide-react";

export function AnimatedLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"} aria-hidden="true">
      <span className="brand-mark-aura" />
      <span className="brand-mark-page brand-mark-page-back" />
      <span className="brand-mark-page brand-mark-page-front">
        <FileStack size={compact ? 18 : 24} strokeWidth={2.2} />
      </span>
    </span>
  );
}
