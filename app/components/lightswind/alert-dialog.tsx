"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import { buttonVariants } from "~/components/lightswind/button";
import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Alert Dialog
 * https://lightswind.com/components/alert-dialog
 *
 * Adapted from the registry version: the uncoloured `border` becomes
 * `border-border`, the motion wrapper is typed so framer-motion's own event
 * handler signatures don't clash, `role="alertdialog"` is set, and `Escape`
 * closes the dialog.
 */

interface AlertDialogContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const AlertDialogContext = React.createContext<AlertDialogContextType | undefined>(undefined);

function useAlertDialogContext() {
  const context = React.useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialog parts must be used within an AlertDialog");
  return context;
}

interface AlertDialogProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AlertDialog: React.FC<AlertDialogProps> = ({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}) => {
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
    <AlertDialogContext.Provider value={{ open, setOpen }}>{children}</AlertDialogContext.Provider>
  );
};

interface AlertDialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const AlertDialogTrigger = React.forwardRef<HTMLButtonElement, AlertDialogTriggerProps>(
  ({ children, asChild = false, ...props }, ref) => {
    const { setOpen } = useAlertDialogContext();
    const { onClick, ...otherProps } = props;

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setOpen(true);
      onClick?.(event);
    };

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler }>;
      return React.cloneElement(child, {
        ...otherProps,
        ref,
        onClick: (event: React.MouseEvent) => {
          handleClick(event as React.MouseEvent<HTMLButtonElement>);
          child.props.onClick?.(event);
        },
      } as Record<string, unknown>);
    }

    return (
      <button ref={ref} type="button" onClick={handleClick} {...otherProps}>
        {children}
      </button>
    );
  }
);
AlertDialogTrigger.displayName = "AlertDialogTrigger";

// framer-motion's own handlers clash with the DOM ones.
type MotionSafeDivProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onTransitionEnd"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
>;

const AlertDialogContent = React.forwardRef<HTMLDivElement, MotionSafeDivProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useAlertDialogContext();
    const contentRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, setOpen]);

    React.useEffect(() => {
      if (!open) return;
      const handleClickOutside = (event: MouseEvent) => {
        if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open, setOpen]);

    if (typeof document === "undefined") return null;

    return (
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.div
              ref={(node) => {
                contentRef.current = node;
                if (typeof ref === "function") ref(node);
                else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
              }}
              role="alertdialog"
              aria-modal="true"
              data-slot="alert-dialog-content"
              className={cn(
                "fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[var(--radius)] border border-border bg-background p-6 shadow-lg",
                className
              )}
              initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.9, x: "-50%", y: "-50%" }}
              transition={{ type: "spring", damping: 25, stiffness: 400, opacity: { duration: 0.2 } }}
              {...props}
            >
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }
);
AlertDialogContent.displayName = "AlertDialogContent";

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
  )
);
AlertDialogTitle.displayName = "AlertDialogTitle";

const AlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

/** Confirm button — closes the dialog, then runs its own `onClick`. */
const AlertDialogAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => {
    const { setOpen } = useAlertDialogContext();
    const { onClick, ...otherProps } = props;

    return (
      <button
        ref={ref}
        type="button"
        className={cn(buttonVariants(), className)}
        onClick={(event) => {
          setOpen(false);
          onClick?.(event);
        }}
        {...otherProps}
      />
    );
  }
);
AlertDialogAction.displayName = "AlertDialogAction";

/** Dismiss button. */
const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => {
  const { setOpen } = useAlertDialogContext();
  const { onClick, ...otherProps } = props;

  return (
    <button
      ref={ref}
      type="button"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      onClick={(event) => {
        setOpen(false);
        onClick?.(event);
      }}
      {...otherProps}
    />
  );
});
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
