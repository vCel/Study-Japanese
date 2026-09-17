import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Toggle Group
 * https://lightswind.com/components/toggle-group
 *
 * Adapted from the registry version in three ways.
 *
 * **One control, not a row of them.** The registry gives each item its own
 * border and a gap between them, which renders as separate buttons that happen
 * to sit together. Here the outline belongs to the group and the items sit
 * flush inside it, so the options read as one control with one hit area.
 *
 * **The builder's pill treatment.** Spacing, type and the states are the ones
 * `quiz-setup.tsx` already uses for its option rows — `px-4 py-1.5 text-sm
 * font-medium`, hover on `bg-muted`, selected as a `primarylw` tint with
 * `primarylw` text — so a mode reads the same as a question type. The pill's
 * border moves up to the group instead of being repeated on the item: two
 * rounded-full outlines two pixels apart render as one ring nested inside
 * another, which is the "separate elements" look this component exists to
 * avoid.
 *
 * Disabled follows the pill as well, and deliberately wins over selected: a
 * greyed option drops its tint entirely, because a control that has stopped
 * applying should not still be advertising which side it is on. The group's
 * border dims with it rather than the whole control taking an opacity, which
 * would stack with the item's own and leave the text at 30%.
 *
 * **Arrow keys.** The registry declares a `radiogroup` but leaves it without the
 * keyboard behaviour that pattern promises, so the arrows move focus and
 * selection together. Without that, the group announces as radios and then
 * ignores the keys a screen reader tells the user to press.
 *
 * The upstream `accent` / `ring-ring` tokens are not part of this theme, and the
 * `.lw-3d` rules it also styles are not used anywhere here, so neither is
 * carried. `variant` and `size` went with them: with one treatment there is
 * nothing left for either to switch.
 *
 * `defaultPressed` is dropped: it applied itself from an empty-dependency effect
 * on mount, and every use here is controlled.
 */

export type ToggleGroupType = "single" | "multiple";

interface ToggleGroupContextValue {
  type: ToggleGroupType;
  value: string | string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | undefined>(undefined);

function useToggleGroupContext(): ToggleGroupContextValue {
  const context = React.useContext(ToggleGroupContext);
  if (!context) throw new Error("ToggleGroupItem must be used within a ToggleGroup");
  return context;
}

export interface ToggleGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  type: ToggleGroupType;
  /** Controlled selection. A string for `single`, an array for `multiple`. */
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  disabled?: boolean;
}

const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, type, value, defaultValue, onValueChange, disabled = false, children, ...props }, ref) => {
    /** `single` reads and writes one string, `multiple` an array — never both. */
    const coerce = (raw: string | string[] | undefined): string | string[] => {
      if (raw === undefined) return type === "single" ? "" : [];
      if (type === "single") return Array.isArray(raw) ? raw[0] || "" : raw;
      return Array.isArray(raw) ? raw : raw ? [raw] : [];
    };

    const [stateValue, setStateValue] = React.useState<string | string[]>(coerce(defaultValue));

    const isControlled = value !== undefined;
    const currentValue = isControlled ? coerce(value) : stateValue;

    const handleValueChange = React.useCallback(
      (itemValue: string) => {
        if (disabled) return;
        const next = (() => {
          if (type === "single") return itemValue;
          const values = Array.isArray(currentValue) ? currentValue : [currentValue].filter(Boolean);
          return values.includes(itemValue)
            ? values.filter((entry) => entry !== itemValue)
            : [...values, itemValue];
        })();
        if (!isControlled) setStateValue(next);
        onValueChange?.(next);
      },
      [currentValue, disabled, isControlled, onValueChange, type]
    );

    /**
     * Selection follows focus, which is what a `radiogroup` promises: the arrows
     * move through the items and land on a chosen one, rather than merely looking
     * at it. Read off the DOM so the group does not have to keep a registry of
     * children it did not create.
     */
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (type !== "single" || disabled) return;
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      if (!forward && !backward) return;
      const step = forward ? 1 : -1;

      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
      );
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (current === -1 || items.length === 0) return;

      event.preventDefault();
      const next = items[(current + step + items.length) % items.length];
      next.focus();
      next.click();
    };

    return (
      <ToggleGroupContext.Provider
        value={{ type, value: currentValue, onChange: handleValueChange, disabled }}
      >
        <div
          ref={ref}
          role={type === "single" ? "radiogroup" : "group"}
          onKeyDown={handleKeyDown}
          className={cn(
            "inline-flex items-center rounded-full border p-0.5",
            disabled ? "border-border/60" : "border-border",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </ToggleGroupContext.Provider>
    );
  }
);
ToggleGroup.displayName = "ToggleGroup";

export interface ToggleGroupItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
}

const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ className, children, value, disabled: itemDisabled, ...props }, ref) => {
    const { type, value: groupValue, onChange, disabled: groupDisabled } = useToggleGroupContext();

    const isActive =
      type === "single"
        ? groupValue === value
        : Array.isArray(groupValue)
          ? groupValue.includes(value)
          : groupValue === value;
    const isDisabled = Boolean(groupDisabled || itemDisabled);

    return (
      <button
        ref={ref}
        type="button"
        role={type === "single" ? "radio" : "checkbox"}
        aria-checked={isActive}
        disabled={isDisabled}
        data-state={isActive ? "on" : "off"}
        onClick={() => onChange(value)}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isDisabled
            ? "cursor-not-allowed text-muted-foreground/50"
            : isActive
              ? "cursor-pointer bg-primarylw/15 text-primarylw"
              : "cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
