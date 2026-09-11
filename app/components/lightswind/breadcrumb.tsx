import * as React from "react";
import { Link } from "react-router";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Breadcrumb
 * https://lightswind.com/components/breadcrumb
 *
 * Adapted to this app in two ways: `BreadcrumbLink` takes a React Router `to`
 * (app routes, not raw hrefs) and the palette uses the Lightswind theme tokens
 * (`border` / `muted-foreground` / `foreground` / `primarylw`).
 */

function Breadcrumb({ className, ...props }: React.ComponentPropsWithoutRef<"nav">) {
  return <nav aria-label="breadcrumb" className={cn(className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground sm:gap-2.5",
        className
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />
  );
}

/** A crumb that navigates — `to` is a React Router route, e.g. `/rules`. */
function BreadcrumbLink({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      className={cn("truncate transition-colors hover:text-foreground", className)}
      {...props}
    />
  );
}

/** The page you are on: plain text, marked as the current item. */
function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("truncate font-normal text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn("shrink-0 [&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
