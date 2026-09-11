import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Button
 * Animated, gradient-accented button built on Tailwind CSS.
 * https://lightswind.com/components/button
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primarylw text-white shadow hover:bg-primarylw-2 hover:shadow-lg hover:shadow-primarylw/25",
        destructive: "bg-red-600 text-white shadow hover:bg-red-700",
        outline:
          "border border-border bg-transparent hover:bg-muted hover:border-primarylw/40",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        ghost: "hover:bg-muted",
        link: "text-primarylw underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-9 rounded-full px-5",
        lg: "h-11 rounded-full px-9",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };