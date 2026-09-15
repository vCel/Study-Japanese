"use client";

import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Scroll Area
 * https://lightswind.com/components/scroll-area
 *
 * Adapted from the registry version: instead of the upstream
 * `themed-scrollbar` / `minimal-scrollbar` CSS helpers (which this project does
 * not ship) the scrollbar is styled with Tailwind attribute variants.
 */

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Reference to the viewport element. */
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  /** Maximum height of the scroll area. */
  maxHeight?: string | number;
  /** Whether to show scrollbars. */
  showScrollbars?: boolean;
  /** Whether to allow scrolling. */
  scrollable?: boolean;
  /** The orientation of the scroll area. */
  orientation?: "vertical" | "horizontal" | "both";
  /** Whether to smooth scroll. */
  smooth?: boolean;
  /** Theme of the scrollbar. */
  theme?: "default" | "minimal" | "none";
}

const SCROLLBAR_THEMES = {
  default:
    "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40",
  minimal:
    "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/60",
  none: "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
};

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      className,
      children,
      viewportRef,
      maxHeight,
      showScrollbars = true,
      scrollable = true,
      orientation = "vertical",
      smooth = false,
      theme = "default",
      style,
      ...props
    },
    ref
  ) => {
    const internalRef = React.useRef<HTMLDivElement>(null);
    const resolvedRef = viewportRef ?? internalRef;

    const orientationClasses = {
      vertical: "overflow-x-hidden overflow-y-auto",
      horizontal: "overflow-y-hidden overflow-x-auto",
      both: "overflow-auto",
    };

    // `max-height` has to sit on the element that actually scrolls.
    //
    // Putting it on the outer wrapper (with `h-full` on the inner viewport) does
    // not work: the outer's height is `auto` — it only has a *max*-height — so the
    // inner's `height: 100%` resolves against an indefinite height and falls back
    // to `auto`, making the viewport exactly as tall as its content. The outer then
    // caps at max-height and `overflow-hidden` clips the rest, so the overflow is
    // not scrollable — it is simply invisible and unreachable.
    const maxHeightStyle =
      maxHeight !== undefined
        ? typeof maxHeight === "number"
          ? `${maxHeight}px`
          : maxHeight
        : undefined;

    return (
      <div
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        style={style}
        {...props}
      >
        <div
          ref={resolvedRef}
          className={cn(
            "h-full w-full rounded-[inherit]",
            scrollable ? orientationClasses[orientation] : "overflow-hidden",
            smooth && "scroll-smooth",
            showScrollbars ? SCROLLBAR_THEMES[theme] : SCROLLBAR_THEMES.none
          )}
          style={{ maxHeight: maxHeightStyle }}
          data-slot="scroll-area-viewport"
        >
          {children}
        </div>
      </div>
    );
  }
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
