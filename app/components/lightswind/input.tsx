import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Input / Textarea
 * https://lightswind.com/components/input
 */
const baseFieldClasses =
  "flex w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:border-primarylw/50 disabled:cursor-not-allowed disabled:opacity-50";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input type={type} className={cn(baseFieldClasses, "h-10", className)} ref={ref} {...props} />
  )
);
Input.displayName = "Input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, onFocus, onBlur, ...props }, ref) => {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <textarea
      ref={ref}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      className={cn(
        "flex min-h-[80px] w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm transition-all duration-300",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        isFocused && "border-primarylw/50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:opacity-70", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";

export { Input, Textarea, Label };