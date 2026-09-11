import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Accordion
 * https://lightswind.com/components/accordion
 *
 * A vertically stacked set of interactive headings that reveal a section of
 * content. Supports `type="single" | "multiple"`, controlled/uncontrolled
 * values and `collapsible`.
 */

interface AccordionContextType {
  value: string[];
  onValueChange: (value: string) => void;
  type: "single" | "multiple";
  collapsible: boolean;
}

const AccordionContext = React.createContext<AccordionContextType | undefined>(undefined);

interface AccordionItemContextType {
  value: string;
}

const AccordionItemContext = React.createContext<AccordionItemContextType | undefined>(undefined);

interface AccordionProps extends React.HTMLAttributes<HTMLDivElement> {
  type?: "single" | "multiple";
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string[]) => void;
  collapsible?: boolean;
}

const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  (
    {
      className,
      type = "single",
      value,
      defaultValue = [],
      onValueChange,
      collapsible = true,
      children,
      ...props
    },
    ref
  ) => {
    const normalizeValue = (val: string | string[] | undefined): string[] => {
      if (Array.isArray(val)) return val;
      return val ? [val] : [];
    };

    const initialValues = normalizeValue(value !== undefined ? value : defaultValue);
    const [values, setValues] = React.useState<string[]>(
      type === "single" && initialValues.length > 1 ? [initialValues[0]] : initialValues
    );

    // Keep state in sync when used as a controlled component.
    React.useEffect(() => {
      if (value !== undefined) {
        const newValues = normalizeValue(value);
        setValues(type === "single" && newValues.length > 1 ? [newValues[0]] : newValues);
      }
    }, [value, type]);

    const handleValueChange = React.useCallback(
      (itemValue: string) => {
        const isCurrentlyOpen = values.includes(itemValue);
        let newValues: string[] = [];

        if (type === "single") {
          if (isCurrentlyOpen) {
            newValues = collapsible ? [] : [itemValue];
          } else {
            newValues = [itemValue];
          }
        } else {
          newValues = isCurrentlyOpen
            ? values.filter((v) => v !== itemValue)
            : [...values, itemValue];
        }

        if (value === undefined) setValues(newValues);
        onValueChange?.(newValues);
      },
      [values, onValueChange, value, type, collapsible]
    );

    return (
      <AccordionContext.Provider
        value={{ value: values, onValueChange: handleValueChange, type, collapsible }}
      >
        <div ref={ref} className={cn(className)} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    );
  }
);
Accordion.displayName = "Accordion";

interface AccordionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  disabled?: boolean;
}

const AccordionItem = React.forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, value, disabled = false, children, ...props }, ref) => (
    <AccordionItemContext.Provider value={{ value }}>
      <div
        ref={ref}
        className={cn("border-b border-border/60", className)}
        data-state={disabled ? "disabled" : undefined}
        data-value={value}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  )
);
AccordionItem.displayName = "AccordionItem";

interface AccordionTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const AccordionTrigger = React.forwardRef<HTMLButtonElement, AccordionTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(AccordionContext);
    if (!context) throw new Error("AccordionTrigger must be used within an Accordion");

    const itemContext = React.useContext(AccordionItemContext);
    if (!itemContext) throw new Error("AccordionTrigger must be used within an AccordionItem");

    const { value: values, onValueChange } = context;
    const { value: itemValue } = itemContext;
    const isOpen = values.includes(itemValue);

    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center justify-between py-4 text-left font-medium transition-all hover:underline",
          className
        )}
        onClick={() => onValueChange(itemValue)}
        data-state={isOpen ? "open" : "closed"}
        {...props}
      >
        <span className="flex-1">{children}</span>
        {/* Morphing plus / minus icon */}
        <span className="relative ml-2 h-4 w-4 shrink-0">
          <Plus
            className={cn(
              "absolute h-4 w-4 transition-all duration-300 ease-in-out",
              isOpen ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
            )}
          />
          <Minus
            className={cn(
              "absolute h-4 w-4 transition-all duration-300 ease-in-out",
              isOpen ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
            )}
          />
        </span>
      </button>
    );
  }
);
AccordionTrigger.displayName = "AccordionTrigger";

interface AccordionContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const AccordionContent = React.forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(AccordionContext);
    if (!context) throw new Error("AccordionContent must be used within an Accordion");

    const itemContext = React.useContext(AccordionItemContext);
    if (!itemContext) throw new Error("AccordionContent must be used within an AccordionItem");

    const { value: values } = context;
    const { value: itemValue } = itemContext;
    const isOpen = values.includes(itemValue);

    const contentRef = React.useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = React.useState(0);

    // Measure the content so it can animate between 0 and its natural height,
    // and keep measuring: fields inside the panel can grow after it is open
    // (wrapped text, added example rows, a textarea the user drags to resize),
    // and a stale height would clip them behind `overflow-hidden`.
    React.useEffect(() => {
      const node = contentRef.current;
      if (!node) return;

      const measure = () => setContentHeight(node.scrollHeight);
      measure();

      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    return (
      <div
        ref={ref}
        data-slot="accordion-content"
        style={{
          height: isOpen ? `${contentHeight}px` : "0px",
          transition: "height 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        className="overflow-hidden"
        data-state={isOpen ? "open" : "closed"}
        // Collapsed content is clipped to 0 height, so take it out of the tab
        // order and the accessibility tree as well.
        inert={!isOpen}
        {...props}
      >
        <div ref={contentRef} className={cn("pb-4 pt-0 text-sm", className)}>
          {children}
        </div>
      </div>
    );
  }
);
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
