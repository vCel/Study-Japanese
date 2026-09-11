import * as React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/lightswind/breadcrumb";
import { cn } from "~/lib/utils";

/** One ancestor step of the trail — the current page is appended by `PageHeader`. */
export interface PageCrumb {
  label: string;
  /** A React Router route, e.g. `/rules`. */
  to: string;
}

/**
 * Canonical page header used by **every** page, so the top of the content is
 * identical whether you are looking at a list, a detail page or a form:
 *
 *   header — title (+ optional badge) on the left, actions on the right
 *   header — subtitle on the left, the item's tags on the right
 *   body   — breadcrumb trail
 *
 * The subtitle row and the breadcrumb row are always rendered, left blank when
 * a page has neither, which keeps the top of the page exactly the same height
 * everywhere and stops it jumping as you navigate into a word, a phrase or a
 * form.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  badge,
  breadcrumbs,
  tags,
  className,
}: {
  title: string;
  /** The subtitle line, shown right under the title. Always rendered. */
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  /** Sits to the right of the title, e.g. a kind badge or a word count. */
  badge?: React.ReactNode;
  /**
   * Ancestors of this page, outermost first. The current page is appended
   * automatically as the last (non-link) crumb, so `/rules/new` passes just
   * `[{ label: "Rules & forms", to: "/rules" }]` and renders
   * `Rules & forms › Add rule`. A page with no ancestors gets no trail.
   */
  breadcrumbs?: PageCrumb[];
  /**
   * The item's own tags, shown to the right of the subtitle (`justify-between`).
   * They wrap under the subtitle on narrow screens, like the actions do.
   */
  tags?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="page-header" className={cn("mb-6", className)}>
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-3xl font-bold tracking-tight">
              {Icon ? <Icon className="h-7 w-7 shrink-0 text-primarylw" /> : null}
              <span className="min-w-0 break-words">{title}</span>
            </h1>
            {badge}
          </div>
          {/*
            The subtitle and the tags share one row. `min-h-6` fits a tag chip,
            so the height is the same with or without tags; on narrow screens
            the tags wrap onto their own line.
          */}
          <div className="mt-1 flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p
              data-slot="page-subtitle"
              className="line-clamp-1 min-h-5 text-sm text-muted-foreground"
            >
              {description}
            </p>
            {tags ? (
              <div data-slot="page-tags" className="flex flex-wrap items-center gap-1.5">
                {tags}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </header>

      {/*
        The trail opens the body rather than sitting above the title. Always
        rendered — a top-level page still reserves the row.
      */}
      <div data-slot="page-crumbs" className="mt-4 flex h-5 items-center">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap">
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={`${crumb.to}-${index}`}>
                  <BreadcrumbItem>
                    <BreadcrumbLink to={crumb.to}>{crumb.label}</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </React.Fragment>
              ))}
              {/* The page you are on: the last crumb, with no link of its own. */}
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
      </div>
    </div>
  );
}
