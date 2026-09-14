import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Slider
 * https://lightswind.com/components/slider
 *
 * Adapted from the registry version to this project's tokens: the upstream
 * `bg-primary` / `bg-secondary` / `ring-ring` classes are not part of this
 * theme, so the track and fill use `muted` and `primarylw` instead.
 *
 * A single-value slider is what the quiz difficulty control needs; multi-thumb
 * ranges work too, since the registry version is a range slider underneath.
 */

export interface SliderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  defaultValue?: number[];
  value?: number[];
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number[]) => void;
  disabled?: boolean;
  /** Show the current value in a bubble above the thumb while dragging. */
  showTooltip?: boolean;
  /** Label the ends of the track with `min` and `max`. */
  showLabels?: boolean;
  /** Overrides for the thumb and the track/fill, for per-instance styling. */
  thumbClassName?: string;
  trackClassName?: string;
  /** Accessible name. Without it the thumb is an unnamed slider. */
  "aria-label"?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    {
      className,
      defaultValue = [0],
      value,
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      disabled = false,
      showTooltip = false,
      showLabels = false,
      thumbClassName = "",
      trackClassName = "",
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const [values, setValues] = React.useState<number[]>(
      value !== undefined ? value : defaultValue
    );
    /** Index of the thumb currently being dragged. */
    const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
    const [tooltipHoverVisible, setTooltipHoverVisible] = React.useState(false);
    const trackRef = React.useRef<HTMLDivElement>(null);

    // Keep internal state in step with a controlled `value` prop.
    React.useEffect(() => {
      if (value !== undefined) setValues(value);
    }, [value]);

    const getValuePercent = React.useCallback(
      (val: number) => ((val - min) / (max - min)) * 100,
      [min, max]
    );

    /** Position → value, snapped to `step` and clamped to the range. */
    const getValueFromClientX = React.useCallback(
      (clientX: number) => {
        const trackRect = trackRef.current?.getBoundingClientRect();
        if (!trackRect) return min;

        const position = clientX - trackRect.left;
        const clampedPosition = Math.max(0, Math.min(trackRect.width, position));
        const percent = clampedPosition / trackRect.width;

        let rawValue = min + percent * (max - min);
        if (step > 0) rawValue = Math.round(rawValue / step) * step;

        return Math.max(min, Math.min(max, rawValue));
      },
      [min, max, step]
    );

    const handlePointerDown = React.useCallback(
      (event: React.PointerEvent, index: number) => {
        if (disabled) return;
        // Stop the drag from selecting text or triggering a click on the track.
        event.preventDefault();
        setDraggingIndex(index);
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      },
      [disabled]
    );

    const handlePointerMove = React.useCallback(
      (event: PointerEvent) => {
        if (draggingIndex === null || !trackRef.current) return;
        const newValue = getValueFromClientX(event.clientX);

        setValues((prev) => {
          const next = [...prev];
          next[draggingIndex] = newValue;
          // Only a range slider needs its thumbs kept in order.
          if (next.length > 1) next.sort((a, b) => a - b);
          // Report from inside the updater: it is the only place with the
          // up-to-date array. Calling the callback with the closed-over
          // `values` would announce the *previous* position on every move.
          onValueChange?.(next);
          return next;
        });
      },
      [draggingIndex, getValueFromClientX, onValueChange]
    );

    const handlePointerUp = React.useCallback(
      (event: PointerEvent) => {
        if (draggingIndex !== null) {
          (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        }
        setDraggingIndex(null);
      },
      [draggingIndex]
    );

    React.useEffect(() => {
      if (draggingIndex !== null) {
        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
      }
      return () => {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
      };
    }, [draggingIndex, handlePointerMove, handlePointerUp]);

    /** Clicking the track jumps the nearest thumb to that spot. */
    const handleTrackClick = React.useCallback(
      (event: React.MouseEvent) => {
        if (disabled || draggingIndex !== null) return;
        const newValue = getValueFromClientX(event.clientX);

        setValues((prev) => {
          const closestIndex = prev.reduce((closestIdx, currentValue, idx) => {
            const closestDiff = Math.abs(prev[closestIdx] - newValue);
            const currentDiff = Math.abs(currentValue - newValue);
            return currentDiff < closestDiff ? idx : closestIdx;
          }, 0);

          const next = [...prev];
          next[closestIndex] = newValue;
          if (next.length > 1) next.sort((a, b) => a - b);
          onValueChange?.(next);
          return next;
        });
      },
      [disabled, draggingIndex, getValueFromClientX, onValueChange]
    );

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent, index: number) => {
        if (disabled) return;

        let newValue = values[index];
        const effectiveStep = step > 0 ? step : (max - min) / 100;
        const largeStep = (max - min) / 10;

        switch (event.key) {
          case "ArrowRight":
          case "ArrowUp":
            newValue = Math.min(max, newValue + effectiveStep);
            break;
          case "ArrowLeft":
          case "ArrowDown":
            newValue = Math.max(min, newValue - effectiveStep);
            break;
          case "PageUp":
            newValue = Math.min(max, newValue + largeStep);
            break;
          case "PageDown":
            newValue = Math.max(min, newValue - largeStep);
            break;
          case "Home":
            newValue = min;
            break;
          case "End":
            newValue = max;
            break;
          default:
            return; // Leave unhandled keys to the browser.
        }

        setValues((prev) => {
          const next = [...prev];
          next[index] = newValue;
          if (next.length > 1) next.sort((a, b) => a - b);
          onValueChange?.(next);
          return next;
        });

        event.preventDefault();
      },
      [disabled, values, min, max, step, onValueChange]
    );

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-8 w-full touch-none items-center select-none",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        {...props}
      >
        {showLabels && (
          <div className="absolute -top-2 flex w-full justify-between text-xs text-muted-foreground">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        )}

        <div
          ref={trackRef}
          className={cn(
            "relative h-2 w-full grow overflow-hidden rounded-full bg-muted",
            trackClassName
          )}
          onClick={handleTrackClick}
        >
          {values.length === 1 && (
            <div
              className="absolute h-full rounded-full bg-primarylw transition-all duration-100 ease-out"
              style={{ left: 0, width: `${getValuePercent(values[0])}%` }}
            />
          )}

          {values.length > 1 && (
            <div
              className="absolute h-full rounded-full bg-primarylw transition-all duration-100 ease-out"
              style={{
                left: `${getValuePercent(Math.min(...values))}%`,
                width: `${getValuePercent(Math.max(...values)) - getValuePercent(Math.min(...values))}%`,
              }}
            />
          )}
        </div>

        {showTooltip &&
          values.map((value, index) => (
            <div
              key={`tooltip-${index}`}
              className={cn(
                "pointer-events-none absolute -top-8 z-10 flex items-center justify-center transition-opacity duration-200",
                tooltipHoverVisible || draggingIndex === index ? "opacity-100" : "opacity-0"
              )}
              style={{ left: `${getValuePercent(value)}%`, transform: "translateX(-50%)" }}
            >
              <div className="rounded bg-primarylw px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-sm">
                {Math.round(value * 100) / 100}
              </div>
            </div>
          ))}

        {values.map((value, index) => (
          <div
            key={`thumb-${index}`}
            className={cn(
              "absolute block h-5 w-5 rounded-full border-2 border-primarylw bg-background shadow-sm transition-all duration-100 ease-out",
              "hover:scale-110 focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              draggingIndex === index && "scale-110 cursor-grabbing",
              disabled ? "cursor-not-allowed" : "cursor-grab",
              thumbClassName
            )}
            style={{
              left: `${getValuePercent(value)}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              touchAction: "none",
            }}
            onPointerDown={(event) => handlePointerDown(event, index)}
            onMouseEnter={() => !disabled && setTooltipHoverVisible(true)}
            onMouseLeave={() => setTooltipHoverVisible(false)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="slider"
            aria-label={ariaLabel}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            // The stepped ladder ("easy/normal/hard") is what assistive tech
            // should announce, not a bare number.
            aria-valuetext={props["aria-valuetext"]}
            tabIndex={disabled ? -1 : 0}
            data-disabled={disabled ? "" : undefined}
          />
        ))}
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
