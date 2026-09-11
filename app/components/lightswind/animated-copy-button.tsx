"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Animated Copy Button
 * https://lightswind.com/components/animated-copy-button
 *
 * Adapted from the registry version: the `ring-ring` utility is remapped to the
 * project's `primarylw` token, and the label is configurable so callers can
 * describe exactly what gets copied.
 */

interface AnimatedCopyButtonProps {
  /** The text that will be copied to the clipboard. */
  textToCopy: string;
  /** Optional classname for the button. */
  className?: string;
  /** Size of the button. */
  size?: "sm" | "md" | "lg";
  /** Accessible label / tooltip. */
  label?: string;
  /** Optional callback fired once the copy succeeded. */
  onCopy?: () => void;
}

export function AnimatedCopyButton({
  textToCopy,
  className,
  size = "md",
  label = "Copy to clipboard",
  onCopy,
}: AnimatedCopyButtonProps) {
  const [isCopied, setIsCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      onCopy?.();
      window.setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied permission).
    }
  };

  const sizes = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" };
  const iconSizes = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-6 w-6" };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={isCopied ? "Copied" : label}
      title={label}
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-border bg-background transition-colors hover:bg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50",
        sizes[size],
        className
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isCopied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute flex items-center justify-center text-emerald-500"
          >
            <Check className={iconSizes[size]} />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute flex items-center justify-center text-foreground/70"
          >
            <Copy className={iconSizes[size]} />
          </motion.span>
        )}
      </AnimatePresence>

      {/* Background ripple on copy. */}
      {isCopied && (
        <motion.span
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 2 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0 rounded-[var(--radius)] bg-emerald-500/20"
        />
      )}
    </button>
  );
}
