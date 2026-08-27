import * as React from "react";

import { cn } from "@/lib/utils";

// Mirrors the field labels used with `.field-input` across the app
// (`text-xs font-black uppercase`) so this primitive stays visually consistent.
const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-xs font-black uppercase leading-4 text-neutral-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export { Label };
