import * as React from "react";
import { Link, useLocation } from "react-router";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Dock (adapted for navigation)
 * https://lightswind.com/components/dock
 *
 * macOS-style dock whose items grow as the pointer approaches. Adapted so each
 * item is a *category*: tapping it opens a popover listing that category's
 * pages, which keeps the dock to five readable buttons on a phone instead of
 * squeezing every route in. A category with a single page links straight to it
 * rather than opening a one-item popover.
 */

export interface DockCategoryLink {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface DockCategory {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  links: DockCategoryLink[];
  /** True when the current route belongs to this category. */
  active: boolean;
  /**
   * Optional popover body. Used when the items depend on client state (the
   * Profile menu shows sign-in links or a sign-out link) — it is only rendered
   * while the popover is open, so it never runs on the server.
   */
  content?: React.ReactNode;
}

interface DockSpring {
  mass: number;
  stiffness: number;
  damping: number;
}

function useDockItemSize(
  mouseX: MotionValue<number>,
  baseItemSize: number,
  magnification: number,
  distance: number,
  itemRef: React.RefObject<HTMLDivElement | null>,
  spring: DockSpring
) {
  const mouseDistance = useTransform(mouseX, (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return distance;
    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return distance;
    return value - rect.x - rect.width / 2;
  });

  const targetSize = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize]
  );

  return useSpring(targetSize, spring);
}

const itemClasses =
  "flex h-full w-full cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border transition-colors";

/** Popover width (`w-60`) and the gap kept between it and the viewport edge. */
const PANEL_WIDTH = 240;
const EDGE_GAP = 8;

function DockEntry({
  category,
  open,
  onToggle,
  active,
  mouseX,
  baseItemSize,
  magnification,
  distance,
  spring,
}: {
  category: DockCategory;
  open: boolean;
  /** Receives the item element so the popover can be anchored to it. */
  onToggle: (anchorEl: HTMLDivElement | null) => void;
  active: boolean;
  mouseX: MotionValue<number>;
  baseItemSize: number;
  magnification: number;
  distance: number;
  spring: DockSpring;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const size = useDockItemSize(mouseX, baseItemSize, magnification, distance, ref, spring);
  const Icon = category.icon;
  const single = category.links.length === 1;

  // A one-page category is a plain link — a popover for a single item would
  // just be an extra tap. Grammar is the one category that small.
  const highlight = active || (open && !single);
  const className = cn(
    itemClasses,
    highlight
      ? "border-primarylw/50 bg-primarylw/15 text-primarylw"
      : "border-border/60 bg-card text-muted-foreground"
  );

  const content = (
    <>
      <Icon className="h-5 w-5 shrink-0" />
      {/* Wraps to two lines so longer category names stay readable on a phone. */}
      <span className="w-full px-0.5 text-center text-[9px] font-medium leading-[1.1]">
        {category.label}
      </span>
    </>
  );

  return (
    <motion.div ref={ref} style={{ width: size, height: size }} className="shrink-0">
      {single ? (
        <Link
          to={category.links[0]!.to}
          aria-current={active ? "page" : undefined}
          className={className}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onToggle(ref.current)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-current={active ? "page" : undefined}
          className={className}
        >
          {content}
        </button>
      )}
    </motion.div>
  );
}

export function Dock({
  categories,
  className,
}: {
  categories: DockCategory[];
  className?: string;
}) {
  const mouseX = useMotionValue(Infinity);
  const { pathname } = useLocation();
  // The open category *and* where to hang its popover, so they can never
  // disagree: `left` is the button centre in container coordinates.
  const [anchor, setAnchor] = React.useState<{ key: string; left: number } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const spring: DockSpring = { mass: 0.1, stiffness: 150, damping: 12 };

  // Navigating away should always dismiss the menu.
  React.useEffect(() => {
    setAnchor(null);
  }, [pathname]);

  React.useEffect(() => {
    if (!anchor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setAnchor(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchor]);

  /** Open/close a category, remembering which button it popped out of. */
  const toggle = (key: string, anchorEl: HTMLDivElement | null) => {
    const container = containerRef.current;
    if (anchor?.key === key || !container || !anchorEl) {
      setAnchor(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const itemRect = anchorEl.getBoundingClientRect();
    const half = Math.min(PANEL_WIDTH, containerRect.width) / 2;
    const centre = itemRect.left + itemRect.width / 2 - containerRect.left;
    // Keep the panel on screen: the outer categories sit close to the edges.
    const left = Math.min(
      Math.max(centre, half + EDGE_GAP),
      Math.max(half + EDGE_GAP, containerRect.width - half - EDGE_GAP)
    );
    setAnchor({ key, left });
  };

  const open = anchor ? categories.find((category) => category.key === anchor.key) : undefined;

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 md:hidden",
        className
      )}
    >
      {open && anchor ? (
        <div
          role="menu"
          aria-label={`${open.label} pages`}
          data-slot="dock-menu"
          style={{ left: anchor.left, transform: "translateX(-50%)" }}
          className="pointer-events-auto absolute bottom-full mb-3 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-background/95 p-2 shadow-xl backdrop-blur-xl"
        >
          <p className="px-3 pt-1 pb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
            {open.label}
          </p>
          {open.content ??
            open.links.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  role="menuitem"
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
        </div>
      ) : null}

      <motion.div
        role="toolbar"
        aria-label="Primary"
        onMouseMove={({ pageX }) => mouseX.set(pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-2xl border border-border bg-background/95 px-2.5 py-2 shadow-xl backdrop-blur-xl"
      >
        {categories.map((category) => (
          <DockEntry
            key={category.key}
            category={category}
            open={anchor?.key === category.key}
            onToggle={(anchorEl) => toggle(category.key, anchorEl)}
            active={category.active}
            mouseX={mouseX}
            baseItemSize={58}
            magnification={72}
            distance={140}
            spring={spring}
          />
        ))}
      </motion.div>
    </div>
  );
}
