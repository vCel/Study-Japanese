"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Drawer
 * https://lightswind.com/components/drawer
 *
 * Adapted from the registry version: the `ring-ring` utility is remapped to the
 * project's `primarylw` token, and the panel also closes on `Escape`.
 */

interface DrawerContextValue {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  side: "top" | "bottom" | "left" | "right";
}

const DrawerContext = React.createContext<DrawerContextValue | undefined>(undefined);

function useDrawerContext() {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error("useDrawerContext must be used within a Drawer");
  return context;
}

interface DrawerProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
}

const Drawer = ({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  side = "bottom",
}: DrawerProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: React.SetStateAction<boolean>) => {
      if (!isControlled) setUncontrolledOpen(value);
      onOpenChange?.(typeof value === "function" ? value(open) : value);
    },
    [isControlled, onOpenChange, open]
  );

  return (
    <DrawerContext.Provider value={{ open, setOpen, side }}>{children}</DrawerContext.Provider>
  );
};

interface DrawerTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DrawerTrigger = React.forwardRef<HTMLButtonElement, DrawerTriggerProps>(
  ({ children, asChild = false, ...props }, ref) => {
    const { setOpen } = useDrawerContext();

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler }>;
      return React.cloneElement(child, {
        ...props,
        ref,
        onClick: (event: React.MouseEvent) => {
          child.props.onClick?.(event);
          props.onClick?.(event as React.MouseEvent<HTMLButtonElement>);
          setOpen(true);
        },
      } as Record<string, unknown>);
    }

    return (
      <button ref={ref} type="button" onClick={() => setOpen(true)} {...props}>
        {children}
      </button>
    );
  }
);
DrawerTrigger.displayName = "DrawerTrigger";

// These HTML event handlers clash with framer-motion's own signatures, so they
// are omitted from the motion.div props (as in the upstream component).
type OmittedDrawerContentHTMLAttributes = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onTransitionEnd"
  | "onDrag"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragExit"
  | "onDragLeave"
  | "onDragOver"
  | "onDragStart"
  | "onDrop"
  | "onMouseDown"
  | "onMouseEnter"
  | "onMouseLeave"
  | "onMouseMove"
  | "onMouseOut"
  | "onMouseOver"
  | "onMouseUp"
  | "onTouchCancel"
  | "onTouchEnd"
  | "onTouchMove"
  | "onTouchStart"
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerOver"
  | "onPointerOut"
  | "onGotPointerCapture"
  | "onLostPointerCapture"
>;

const DrawerContent = React.forwardRef<HTMLDivElement, OmittedDrawerContentHTMLAttributes>(
  ({ children, className, ...props }, ref) => {
    const { open, setOpen, side } = useDrawerContext();

    const variants = {
      top: {
        initial: { y: "-100%", opacity: 0.5, scale: 0.9 },
        animate: { y: 0, opacity: 1, scale: 1 },
        exit: { y: "-100%", opacity: 0.5, scale: 0.9 },
      },
      bottom: {
        initial: { y: "100%", opacity: 0.5, scale: 0.9 },
        animate: { y: 0, opacity: 1, scale: 1 },
        exit: { y: "100%", opacity: 0.5, scale: 0.9 },
      },
      left: {
        initial: { x: "-100%", opacity: 0.5, scale: 0.9 },
        animate: { x: 0, opacity: 1, scale: 1 },
        exit: { x: "-100%", opacity: 0.5, scale: 0.9 },
      },
      right: {
        initial: { x: "100%", opacity: 0.5, scale: 0.9 },
        animate: { x: 0, opacity: 1, scale: 1 },
        exit: { x: "100%", opacity: 0.5, scale: 0.9 },
      },
    };

    const sideOrigins = {
      top: "top center",
      bottom: "bottom center",
      left: "center left",
      right: "center right",
    };

    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);

    React.useEffect(() => {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, setOpen]);

    if (!mounted) return null;

    return createPortal(
      <AnimatePresence>
        {open && (
          <div
            className={cn(
              "fixed inset-0 z-50 mx-auto flex",
              side === "top" && "flex-col items-center justify-start",
              side === "bottom" && "flex-col items-center justify-end",
              side === "left" && "flex-row items-start justify-start",
              side === "right" && "flex-row items-start justify-end"
            )}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            <motion.div
              ref={ref}
              initial={variants[side].initial}
              animate={variants[side].animate}
              exit={variants[side].exit}
              transition={{ type: "spring", damping: 25, stiffness: 300, opacity: { duration: 0.2 } }}
              style={{ transformOrigin: sideOrigins[side] }}
              className={cn(
                "relative z-50 border-border/50 bg-background shadow-2xl outline-none",
                (side === "top" || side === "bottom") &&
                  "max-h-[90vh] w-full max-w-lg overflow-y-auto border-t",
                side === "left" && "h-full w-3/4 max-w-sm overflow-y-auto rounded-r-3xl border-r",
                side === "right" && "h-full w-3/4 max-w-sm overflow-y-auto rounded-l-3xl border-l",
                className
              )}
              role="dialog"
              aria-modal="true"
              data-slot="drawer-content"
              {...props}
            >
              {(side === "bottom" || side === "top") && (
                <div className="mx-auto my-2 h-1.5 w-16 rounded-full bg-muted" />
              )}
              {children}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute top-4 right-4 cursor-pointer rounded-sm p-1 opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:outline-none"
                aria-label="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
      document.body
    );
  }
);
DrawerContent.displayName = "DrawerContent";

interface DrawerCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DrawerClose = React.forwardRef<HTMLButtonElement, DrawerCloseProps>(
  ({ children, asChild = false, ...props }, ref) => {
    const { setOpen } = useDrawerContext();

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler }>;
      return React.cloneElement(child, {
        ...props,
        ref,
        onClick: (event: React.MouseEvent) => {
          child.props.onClick?.(event);
          props.onClick?.(event as React.MouseEvent<HTMLButtonElement>);
          setOpen(false);
        },
      } as Record<string, unknown>);
    }

    return (
      <button ref={ref} type="button" onClick={() => setOpen(false)} {...props}>
        {children}
      </button>
    );
  }
);
DrawerClose.displayName = "DrawerClose";

const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 p-4 text-center sm:text-left", className)} {...props} />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 p-4 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  )
);
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = "DrawerDescription";

export {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
