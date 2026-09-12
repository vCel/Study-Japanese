import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Switch
 *
 * An on/off control for a single setting. A `role="switch"` button rather than
 * a checkbox, so it reads as "this is on" instead of "tick this to apply".
 *
 * ```tsx
 * <Switch checked={on} onCheckedChange={setOn} aria-label="Spaced repetition" />
 * ```
 */

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primarylw bg-primarylw" : "border-border bg-muted",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  )
);
Switch.displayName = "Switch";
