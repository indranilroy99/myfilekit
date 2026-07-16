import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type LiquidButtonVariant = "primary" | "outline" | "ghost";
type LiquidButtonSize = "sm" | "default" | "lg";

type LiquidButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: LiquidButtonVariant;
  size?: LiquidButtonSize;
};

const sizeClasses: Record<LiquidButtonSize, string> = {
  sm: "liquid-button-sm",
  default: "liquid-button-default",
  lg: "liquid-button-lg",
};

/** A restrained glass-like button for primary actions without filter effects. */
export const LiquidButton = forwardRef<HTMLButtonElement, LiquidButtonProps>(
  ({ children, className = "", variant = "primary", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`liquid-button liquid-button-${variant} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      <span className="liquid-button-surface" aria-hidden="true" />
      <span className="liquid-button-content">{children}</span>
    </button>
  ),
);

LiquidButton.displayName = "LiquidButton";
