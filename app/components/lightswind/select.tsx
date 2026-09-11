import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Select
 * https://lightswind.com/components/select
 *
 * Adapted for this project: styled with the app's theme tokens (`bg-card`,
 * `border-border`, `primarylw`…) instead of the upstream `popover`/`accent`
 * palette, and `SelectValue` renders its children so the trigger shows the
 * option's label rather than its raw value.
 *
 * Note: this is not a native form control. Pair it with
 * `app/components/select-field.tsx`, which mirrors the value into a hidden
 * input so it submits with the surrounding form.
 */

interface SelectContextType {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const SelectContext = React.createContext<SelectContextType | undefined>(undefined);

interface SelectProps {
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

const Select: React.FC<SelectProps> = ({
  children,
  defaultValue = "",
  value,
  onValueChange,
  defaultOpen = false,
  open,
  onOpenChange,
  disabled = false,
}) => {
  const [selectedValue, setSelectedValue] = React.useState(value || defaultValue);
  const [isOpen, setIsOpen] = React.useState(open || defaultOpen);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    if (value !== undefined) setSelectedValue(value);
  }, [value]);

  React.useEffect(() => {
    if (open !== undefined) setIsOpen(open);
  }, [open]);

  React.useEffect(() => {
    if (!isOpen) setSearchQuery("");
  }, [isOpen]);

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (value === undefined) setSelectedValue(newValue);
      onValueChange?.(newValue);
    },
    [onValueChange, value]
  );

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (disabled) return;
      if (open === undefined) setIsOpen(newOpen);
      onOpenChange?.(newOpen);
    },
    [onOpenChange, open, disabled]
  );

  return (
    <SelectContext.Provider
      value={{
        value: selectedValue,
        onValueChange: handleValueChange,
        open: isOpen,
        setOpen: handleOpenChange,
        triggerRef,
        searchQuery,
        setSearchQuery,
      }}
    >
      {children}
    </SelectContext.Provider>
  );
};

const SelectGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  ...props
}) => (
  <div className="px-1 py-1.5" {...props}>
    {children}
  </div>
);
SelectGroup.displayName = "SelectGroup";

interface SelectValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  placeholder?: string;
}

const SelectValue = React.forwardRef<HTMLSpanElement, SelectValueProps>(
  ({ className, placeholder, children, ...props }, ref) => {
    const context = React.useContext(SelectContext);
    if (!context) throw new Error("SelectValue must be used within a Select");

    // Prefer an explicit label so the trigger never shows a raw option value.
    const content = children ?? context.value ?? null;

    return (
      <span ref={ref} className={cn("line-clamp-1 text-sm", className)} {...props}>
        {content || <span className="text-muted-foreground">{placeholder ?? "Select"}</span>}
      </span>
    );
  }
);
SelectValue.displayName = "SelectValue";

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext);
    if (!context) throw new Error("SelectTrigger must be used within a Select");

    const { open, setOpen, triggerRef, searchQuery, setSearchQuery } = context;
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      if (open && searchInputRef.current) searchInputRef.current.focus();
    }, [open]);

    React.useImperativeHandle(ref, () => triggerRef.current!, [triggerRef]);

    return (
      <button
        ref={triggerRef}
        type="button"
        data-state={open ? "open" : "closed"}
        className={cn(
          "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 focus-visible:border-primarylw/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        {...props}
      >
        {open ? (
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder="Search…"
            className="w-full border-none bg-transparent p-0 text-sm outline-none ring-0 focus:outline-none focus:ring-0"
          />
        ) : (
          children
        )}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 opacity-50 transition-transform", open && "rotate-180")}
        />
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

interface SelectContentProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, align = "start", sideOffset = 4, ...props }, ref) => {
    const context = React.useContext(SelectContext);
    if (!context) throw new Error("SelectContent must be used within a Select");

    const { open, setOpen, triggerRef, searchQuery } = context;
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = React.useState<React.CSSProperties>({});
    const [side, setSide] = React.useState<"top" | "bottom">("bottom");
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => setMounted(true), []);

    React.useEffect(() => {
      if (!open || !triggerRef.current) return;

      const updatePosition = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const maxHeight = 224;

        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const showBelow = spaceBelow >= maxHeight || spaceBelow > spaceAbove;
        const nextSide = showBelow ? "bottom" : "top";
        setSide(nextSide);

        const next: React.CSSProperties = {
          position: "absolute",
          width: `${rect.width}px`,
        };

        if (nextSide === "bottom") {
          next.maxHeight = `${Math.min(maxHeight, Math.max(0, spaceBelow - sideOffset - 8))}px`;
          next.top = `${rect.bottom + window.scrollY + sideOffset}px`;
        } else {
          next.maxHeight = `${Math.min(maxHeight, Math.max(0, spaceAbove - sideOffset - 8))}px`;
          next.bottom = `${viewportHeight - rect.top - window.scrollY + sideOffset}px`;
        }

        let left = rect.left;
        if (align === "end") left = rect.right - rect.width;
        if (left + rect.width > viewportWidth) left = viewportWidth - rect.width - 8;
        if (left < 0) left = 8;
        next.left = `${left + window.scrollX}px`;

        setStyle(next);
      };

      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }, [open, align, sideOffset, triggerRef]);

    React.useEffect(() => {
      if (!open) return;
      const onClickOutside = (event: MouseEvent) => {
        if (
          contentRef.current &&
          !contentRef.current.contains(event.target as Node) &&
          triggerRef.current &&
          !triggerRef.current.contains(event.target as Node)
        ) {
          setOpen(false);
        }
      };
      const onEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onClickOutside);
      document.addEventListener("keydown", onEscape);
      return () => {
        document.removeEventListener("mousedown", onClickOutside);
        document.removeEventListener("keydown", onEscape);
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

    const filteredChildren = React.useMemo(() => {
      if (!searchQuery) return children;
      const query = searchQuery.toLowerCase();

      const textOf = (child: React.ReactNode): string => {
        if (typeof child === "string" || typeof child === "number") return child.toString();
        if (React.isValidElement(child)) {
          const element = child as React.ReactElement<{ children?: React.ReactNode }>;
          if (element.props.children) {
            const mapped = React.Children.map(element.props.children, textOf);
            if (mapped) return mapped.join("");
          }
        }
        return "";
      };

      return React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        const element = child as React.ReactElement<{ children?: React.ReactNode }>;
        if ((element.type as { displayName?: string }).displayName === "SelectItem") {
          return textOf(element.props.children).toLowerCase().includes(query) ? element : null;
        }
        return element;
      });
    }, [children, searchQuery]);

    const hasVisibleChildren = React.Children.count(filteredChildren) > 0;

    if (!mounted) return null;

    return createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            ref={combinedRef}
            style={style}
            className={cn(
              "z-50 min-w-[8rem] overflow-hidden rounded-[var(--radius)] border border-border bg-card text-foreground shadow-xl",
              className
            )}
            initial={{ opacity: 0, y: side === "bottom" ? -10 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === "bottom" ? -10 : 10 }}
            transition={{ duration: 0.2 }}
            {...props}
          >
            <div
              role="listbox"
              className="p-1"
              style={{ maxHeight: style.maxHeight, overflowY: "auto" }}
            >
              {hasVisibleChildren ? (
                filteredChildren
              ) : (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No results found.</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );
  }
);
SelectContent.displayName = "SelectContent";

const SelectLabel = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
      {...props}
    />
  )
);
SelectLabel.displayName = "SelectLabel";

interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  disabled?: boolean;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value, disabled = false, ...props }, ref) => {
    const context = React.useContext(SelectContext);
    if (!context) throw new Error("SelectItem must be used within a Select");

    const { value: selectedValue, onValueChange, setOpen } = context;
    const isSelected = selectedValue === value;

    const handleSelect = (event: React.MouseEvent | React.KeyboardEvent) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      onValueChange(value);
      setTimeout(() => setOpen(false), 50);
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors",
          isSelected ? "bg-primarylw/15 text-primarylw" : "hover:bg-muted hover:text-foreground",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        onClick={handleSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") handleSelect(event);
        }}
        aria-selected={isSelected}
        data-disabled={disabled}
        role="option"
        tabIndex={disabled ? -1 : 0}
        {...props}
      >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          {isSelected && <Check className="h-4 w-4" />}
        </span>
        <span className="text-sm">{children}</span>
      </div>
    );
  }
);
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  )
);
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
