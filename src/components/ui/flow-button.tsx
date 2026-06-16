import { ArrowRight } from "lucide-react";

type FlowButtonProps = {
  text?: string;
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
};

export function FlowButton({ text = "Modern Button", ariaLabel, onClick, className = "", type = "button" }: FlowButtonProps) {
  return (
    <button
      className={`flow-button group relative flex cursor-pointer items-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] bg-transparent px-8 py-3 text-sm font-semibold transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:rounded-[12px] hover:border-transparent active:scale-[0.95] ${className}`}
      type={type}
      onClick={onClick}
      aria-label={ariaLabel || text}
    >
      <ArrowRight className="flow-button-arrow absolute left-[-25%] z-[9] h-4 w-4 fill-none transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:left-4" />
      <span className="relative z-[1] -translate-x-3 transition-all duration-[800ms] ease-out group-hover:translate-x-3">
        {text}
      </span>
      <span className="flow-button-fill absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:h-[220px] group-hover:w-[220px] group-hover:opacity-100" />
      <ArrowRight className="flow-button-arrow absolute right-4 z-[9] h-4 w-4 fill-none transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:right-[-25%]" />
    </button>
  );
}
