import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/lightswind/select";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Form-friendly wrapper around the Lightswind `Select`.
 *
 * The Select is not a native control, so the chosen value is kept in state and
 * mirrored into a hidden input — the surrounding `<Form>` then submits it like
 * any other field.
 */
export function SelectField({
  name,
  options,
  defaultValue = "",
  value: controlledValue,
  onValueChange,
  placeholder = "Select",
  ariaLabel,
  id,
  className,
  triggerClassName,
}: {
  /** Omit to use the select purely as a controlled input (no hidden field). */
  name?: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const value = controlledValue ?? uncontrolled;
  const label = options.find((option) => option.value === value)?.label;

  const handleValueChange = (next: string) => {
    if (controlledValue === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };

  return (
    <div className={className}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Select value={value} onValueChange={handleValueChange}>
        <SelectTrigger
          id={id}
          aria-label={ariaLabel ?? placeholder}
          className={triggerClassName}
        >
          <SelectValue placeholder={placeholder}>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value || "__empty"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
