import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Tooltip
 *
 * A short hint that appears on hover or keyboard focus, replacing the native
 * `title` attribute so hints look the same everywhere (and actually show up on
 * touch-free focus). Portalled and hand-positioned like `popover.tsx`, so the
 * app needs no positioning dependency.
 *
 * It clones its single child to attach the hover/focus handlers and the ref —
 * no wrapper element, so surrounding layouts are untouched:
 *
 * ```tsx
 * <Tooltip content="What this does">
 *   <button type="button">…</button>
 * </Tooltip>
 * ```
 */

type TooltipSide = "top" | "bottom";

interface TooltipProps {
  /** Bubble contents — a short sentence reads best. */
  content: React.ReactNode;
  /** The element being described. It must accept a ref. */
  children: React.ReactElement;
  /** Preferred side; flips automatically when there is no room. */
  side?: TooltipSide;
  /** Gap between the trigger and the bubble, in px. */
  sideOffset?: number;
  /** Hover delay before the bubble appears, in ms. */
  delay?: number;
  className?: string;
}

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delay = 120,
  className,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [placement, setPlacement] = React.useState<TooltipSide>(side);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<number | null>(null);
  // Hidden until measured, so it never paints in the wrong spot.
  const [style, setStyle] = React.useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });
  const id = React.useId();

  React.useEffect(() => setMounted(true), []);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  // Drop any pending show-timer if the tooltip unmounts mid-delay.
  React.useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const show = React.useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = React.useCallback(() => {
    clearTimer();
    setOpen(false);
  }, []);

  // Measure and place the bubble before the browser paints it.
  React.useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current;
      const bubble = bubbleRef.current;
      if (!trigger || !bubble) return;

      const rect = trigger.getBoundingClientRect();
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const fits =
        side === "top"
          ? rect.top >= height + sideOffset
          : window.innerHeight - rect.bottom >= height + sideOffset;
      const next: TooltipSide = fits ? side : side === "top" ? "bottom" : "top";
      setPlacement(next);

      let left = rect.left + rect.width / 2 - width / 2;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;

      setStyle({
        position: "fixed",
        left: `${left}px`,
        top:
          next === "top"
            ? `${rect.top - height - sideOffset}px`
            : `${rect.bottom + sideOffset}px`,
        visibility: "visible",
      });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, side, sideOffset]);

  // Chain whatever handlers the child already had instead of replacing them.
  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props as {
    ref?: React.Ref<HTMLElement>;
    onMouseEnter?: React.MouseEventHandler;
    onMouseLeave?: React.MouseEventHandler;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
  };

  const trigger = React.cloneElement(child, {
    ref: mergeRefs(childProps.ref, triggerRef),
    // Only once it is open: `useId` is not stable across SSR here (the Convex
    // provider wraps the tree on the client only), and an attribute that only
    // appears after a hover can never mismatch the server markup.
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (event: React.MouseEvent) => {
      childProps.onMouseEnter?.(event);
      show();
    },
    onMouseLeave: (event: React.MouseEvent) => {
      childProps.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: React.FocusEvent) => {
      childProps.onFocus?.(event);
      show();
    },
    onBlur: (event: React.FocusEvent) => {
      childProps.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={bubbleRef}
                id={id}
                role="tooltip"
                data-slot="tooltip"
                data-side={placement}
                style={style}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className={cn(
                  "pointer-events-none z-50 max-w-64 rounded-[var(--radius)] border border-border bg-card px-2.5 py-1.5 text-xs leading-snug text-foreground shadow-lg",
                  className
                )}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
