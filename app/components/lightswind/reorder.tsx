import * as React from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, X } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Draggable Reorder List (adapted)
 * https://lightswind.com/components/draggable-reorder-list
 *
 * The published component renders plain labels; this version keeps the same
 * grip-handle + row styling but accepts arbitrary children, so rows can hold
 * editable inputs. Reorder by dragging the handle only, which leaves the
 * inputs fully usable.
 */
export function ReorderList<T>({
  values,
  onReorder,
  children,
  className,
}: {
  values: T[];
  onReorder: (next: T[]) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Reorder.Group
      axis="y"
      as="div"
      values={values}
      onReorder={onReorder}
      className={cn("flex flex-col gap-2", className)}
    >
      {children}
    </Reorder.Group>
  );
}

export function ReorderRow<T>({
  value,
  onRemove,
  removeLabel,
  children,
  className,
}: {
  value: T;
  onRemove: () => void;
  removeLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dragControls = useDragControls();
  const [dragging, setDragging] = React.useState(false);

  return (
    <Reorder.Item
      value={value}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      className="relative"
    >
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-3 shadow-sm transition-shadow",
          dragging && "shadow-lg ring-1 ring-primarylw/30",
          className
        )}
      >
        <button
          type="button"
          onPointerDown={(event) => dragControls.start(event)}
          aria-label="Drag to reorder"
          className="mt-2 shrink-0 cursor-grab touch-none text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">{children}</div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}
