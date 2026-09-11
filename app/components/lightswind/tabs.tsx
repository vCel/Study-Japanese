"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Tabs
 * https://lightswind.com/components/tabs
 *
 * Adapted from the registry version: the sliding indicator uses the project's
 * `primarylw` token (the upstream `bg-gradient-tabs` / `ring-ring` classes are
 * not part of this theme).
 */

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  updateIndicator: () => void;
  scheduleUpdateIndicator: () => void;
  indicatorStyle: React.CSSProperties;
  mounted: boolean;
  registerTabTrigger: (value: string, element: HTMLButtonElement | null) => void;
  registerTabsList: (element: HTMLDivElement | null) => void;
}

const TabsContext = React.createContext<TabsContextValue>({
  value: "",
  onValueChange: () => {},
  updateIndicator: () => {},
  scheduleUpdateIndicator: () => {},
  indicatorStyle: {},
  mounted: false,
  registerTabTrigger: () => {},
  registerTabsList: () => {},
});

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, defaultValue, value, onValueChange, children, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue || "");
    const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({});
    const [mounted, setMounted] = React.useState(false);
    const tabsListRef = React.useRef<HTMLDivElement | null>(null);
    const tabTriggerRefs = React.useRef(new Map<string, HTMLButtonElement | null>());

    const controlled = value !== undefined;
    const currentValue = controlled ? value : internalValue;

    const registerTabsList = React.useCallback((element: HTMLDivElement | null) => {
      tabsListRef.current = element;
    }, []);

    const registerTabTrigger = React.useCallback(
      (tabValue: string, element: HTMLButtonElement | null) => {
        if (element) tabTriggerRefs.current.set(tabValue, element);
        else tabTriggerRefs.current.delete(tabValue);
      },
      []
    );

    const updateIndicator = React.useCallback(() => {
      if (!tabsListRef.current || !currentValue) return;
      const activeTab = tabTriggerRefs.current.get(currentValue);
      if (!activeTab) return;
      const tabRect = activeTab.getBoundingClientRect();
      const listRect = tabsListRef.current.getBoundingClientRect();
      // Both rects need real dimensions before the indicator can be placed.
      if (tabRect.width > 0 && listRect.width > 0) {
        setIndicatorStyle({
          left: `${tabRect.left - listRect.left}px`,
          width: `${tabRect.width}px`,
        });
      }
    }, [currentValue]);

    const scheduleUpdateIndicator = React.useCallback(() => {
      // Defer to the next frame so the browser has painted the layout.
      requestAnimationFrame(() => updateIndicator());
    }, [updateIndicator]);

    React.useEffect(() => {
      setMounted(true);
      scheduleUpdateIndicator();
      window.addEventListener("resize", scheduleUpdateIndicator);
      return () => window.removeEventListener("resize", scheduleUpdateIndicator);
    }, [scheduleUpdateIndicator]);

    // Re-measure when the list becomes visible (e.g. inside a drawer/popover).
    React.useEffect(() => {
      const listEl = tabsListRef.current;
      if (!listEl || typeof IntersectionObserver === "undefined") return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) scheduleUpdateIndicator();
        },
        { threshold: 0.1 }
      );
      observer.observe(listEl);
      return () => observer.disconnect();
    }, [scheduleUpdateIndicator]);

    const handleValueChange = React.useCallback(
      (next: string) => {
        if (!controlled) setInternalValue(next);
        onValueChange?.(next);
      },
      [controlled, onValueChange]
    );

    return (
      <TabsContext.Provider
        value={{
          value: currentValue,
          onValueChange: handleValueChange,
          updateIndicator,
          scheduleUpdateIndicator,
          indicatorStyle,
          mounted,
          registerTabTrigger,
          registerTabsList,
        }}
      >
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { indicatorStyle, registerTabsList, mounted } = React.useContext(TabsContext);

    return (
      <div
        ref={(el) => {
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
          registerTabsList(el);
        }}
        role="tablist"
        className={cn(
          "relative inline-flex items-center justify-center rounded-full border border-border bg-muted p-1",
          className
        )}
        {...props}
      >
        {mounted && (
          <motion.div
            layout
            aria-hidden="true"
            className="absolute top-1 bottom-1 z-0 rounded-full bg-primarylw"
            style={{ ...indicatorStyle, position: "absolute", borderRadius: "9999px" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
        {props.children}
      </div>
    );
  }
);
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, ...props }, ref) => {
  const { value: selectedValue, onValueChange, registerTabTrigger, scheduleUpdateIndicator } =
    React.useContext(TabsContext);
  const isActive = selectedValue === value;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    registerTabTrigger(value, triggerRef.current);
    return () => registerTabTrigger(value, null);
  }, [value, registerTabTrigger]);

  React.useEffect(() => {
    if (isActive) scheduleUpdateIndicator();
  }, [isActive, scheduleUpdateIndicator]);

  return (
    <button
      ref={(el) => {
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
        triggerRef.current = el;
      }}
      type="button"
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      data-value={value}
      className={cn(
        "relative z-10 inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 disabled:pointer-events-none disabled:opacity-50",
        isActive ? "text-white" : "text-muted-foreground hover:text-foreground",
        className
      )}
      onClick={(event) => {
        onValueChange(value);
        props.onClick?.(event);
      }}
      {...props}
    />
  );
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  HTMLDivElement,
  { value: string } & React.ComponentPropsWithoutRef<"div">
>(({ className, value, children, ...props }, ref) => {
  const { value: selectedValue, updateIndicator } = React.useContext(TabsContext);
  const isActive = selectedValue === value;
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  // The indicator depends on the panel's layout, so re-measure on resize.
  React.useEffect(() => {
    if (!isActive || !contentRef.current) return;
    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [isActive, updateIndicator]);

  return (
    <AnimatePresence mode="wait">
      {isActive && (
        <div
          key={value}
          ref={(el) => {
            contentRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          role="tabpanel"
          data-state="active"
          data-value={value}
          data-slot="tabs-content"
          className={cn(
            "mt-4 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50",
            className
          )}
          {...props}
        >
          {children}
        </div>
      )}
    </AnimatePresence>
  );
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
