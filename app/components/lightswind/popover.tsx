import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Popover
 *
 * A small panel anchored to a trigger, for the odd place where a second
 * button would be noise. Portalled and hand-positioned in the same style as
 * `select.tsx`, so no positioning dependency is needed.
 *
 * ```tsx
 * <Popover>
 *   <PopoverTrigger className="…">Open</PopoverTrigger>
 *   <PopoverContent align="end" className="w-64 p-1">
 *     <Link role="menuitem" …>…</Link>
 *   </PopoverContent>
 * </Popover>
 * ```
 */

interface PopoverContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const PopoverContext = React.createContext<PopoverContextType | undefined>(undefined);

function usePopover(): PopoverContextType {
  const context = React.useContext(PopoverContext);
  if (!context) throw new Error("Popover parts must be used within a <Popover>");
  return context;
}

interface PopoverProps {
  children: React.ReactNode;
  /** Controlled open state — omit to let the popover manage it itself. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ children, open, defaultOpen = false, onOpenChange }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  return (
    <PopoverContext.Provider value={{ open: isOpen, setOpen, triggerRef }}>
      {children}
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ className, children, onClick, ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();

    React.useImperativeHandle(ref, () => triggerRef.current!, [triggerRef]);

    return (
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setOpen(!open);
        }}
        className={cn("inline-flex cursor-pointer items-center gap-2", className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);
PopoverTrigger.displayName = "PopoverTrigger";

interface PopoverContentProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, children, align = "start", sideOffset = 6, ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    // Hidden until the first measurement lands, so the panel never paints in
    // the wrong spot.
    const [style, setStyle] = React.useState<React.CSSProperties>({
      position: "absolute",
      top: 0,
      left: 0,
      visibility: "hidden",
    });
    const [side, setSide] = React.useState<"top" | "bottom">("bottom");
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => setMounted(true), []);

    const position = React.useCallback(() => {
      const trigger = triggerRef.current;
      const content = contentRef.current;
      if (!trigger || !content) return;

      const rect = trigger.getBoundingClientRect();
      const width = content.offsetWidth;
      const height = content.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const showBelow = spaceBelow >= height + sideOffset || spaceBelow > spaceAbove;

      let left = rect.left;
      if (align === "end") left = rect.right - width;
      else if (align === "center") left = rect.left + rect.width / 2 - width / 2;
      if (left + width > window.innerWidth) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;

      setSide(showBelow ? "bottom" : "top");
      setStyle({
        position: "absolute",
        left: `${left + window.scrollX}px`,
        ...(showBelow
          ? { top: `${rect.bottom + window.scrollY + sideOffset}px` }
          : { top: `${rect.top + window.scrollY - height - sideOffset}px` }),
        visibility: "visible",
      });
    }, [align, sideOffset, triggerRef]);

    // Measure after the panel is in the DOM, before the browser paints.
    React.useLayoutEffect(() => {
      if (!open) return;
      position();
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      return () => {
        window.removeEventListener("resize", position);
        window.removeEventListener("scroll", position, true);
      };
    }, [open, position]);

    React.useEffect(() => {
      if (!open) return;
      const onPointerDown = (event: MouseEvent) => {
        if (contentRef.current?.contains(event.target as Node)) return;
        if (triggerRef.current?.contains(event.target as Node)) return;
        setOpen(false);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [open, setOpen, triggerRef]);

    const combinedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref]
    );

    if (!mounted) return null;

    return createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            ref={combinedRef}
            role="menu"
            data-slot="popover"
            tabIndex={-1}
            style={style}
            className={cn(
              "z-50 overflow-hidden rounded-[var(--radius)] border border-border bg-card text-foreground shadow-xl outline-none",
              className
            )}
            initial={{ opacity: 0, y: side === "bottom" ? -8 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === "bottom" ? -8 : 8 }}
            transition={{ duration: 0.15 }}
            {...props}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );
  }
);
PopoverContent.displayName = "PopoverContent";
