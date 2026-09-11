import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Toast
 * Lightweight animated toast notifications (window event based).
 * https://lightswind.com/components/toast
 */

export type ToastVariant = "success" | "error" | "info";

export interface ToastPayload {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

export function toast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent<ToastPayload>("lightswind:toast", { detail: payload }));
}

const variantClasses: Record<ToastVariant, string> = {
  success: "border-emerald-500/40 [&>div:first-child]:bg-emerald-500",
  error: "border-red-500/40 [&>div:first-child]:bg-red-500",
  info: "border-primarylw/40 [&>div:first-child]:bg-primarylw",
};

export function Toaster() {
  const [toasts, setToasts] = React.useState<(ToastPayload & { id: number })[]>([]);

  React.useEffect(() => {
    let counter = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      const id = ++counter;
      setToasts((prev) => [...prev.slice(-3), { ...detail, id }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    };
    window.addEventListener("lightswind:toast", handler);
    return () => window.removeEventListener("lightswind:toast", handler);
  }, []);

  return (
    <div
      data-slot="toaster"
      className="pointer-events-none fixed right-4 bottom-24 z-100 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-slot="toast"
          data-variant={t.variant ?? "info"}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-lg",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
            variantClasses[t.variant ?? "info"]
          )}
        >
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full" />
          <div>
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}