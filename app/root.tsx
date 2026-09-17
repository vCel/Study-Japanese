import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigation,
} from "react-router";
import * as React from "react";

import type { Route } from "./+types/root";
import { ConvexClientProvider } from "~/components/convex-provider";
import { DeviceSyncPrompt } from "~/components/device-sync-prompt";
import { MobileNav, Sidebar } from "~/components/sidebar";
import { PageSkeleton } from "~/components/page-skeleton";
import { Toaster } from "~/components/lightswind/toast";
import { useBrowsingPageRecorder } from "~/lib/return-to";
import {
  AuthUnavailableError,
  deviceCookieHeader,
  ownerContext,
  resolveOwnerFromRequest,
  type OwnerInfo,
} from "~/lib/owner.server";
import { cn } from "~/lib/utils";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

/**
 * Resolves who this request belongs to (account user or device) and persists a
 * freshly created device cookie. Runs for every page and action so loaders and
 * actions can read `ownerContext` instead of re-authenticating individually.
 *
 * When the viewer cannot be identified because the auth service is unreachable,
 * the request fails instead of falling through to the device owner: a signed-in
 * user must not be shown a library that is not theirs, and they would have no
 * way to tell that it happened.
 */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    let owner: OwnerInfo;
    try {
      owner = await resolveOwnerFromRequest(request);
    } catch (error) {
      if (error instanceof AuthUnavailableError) {
        throw data(error.message, { status: 503, statusText: error.message });
      }
      throw error;
    }
    context.set(ownerContext, owner);

    const response = await next();

    if (owner.deviceIsNew) {
      const isHttps = new URL(request.url).protocol === "https:";
      response.headers.append("Set-Cookie", deviceCookieHeader(owner.deviceId, isHttps));
    }
    return response;
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * `true` only once `active` has stayed true for `delay` ms, so a fast navigation
 * (loader data already prefetched on hover) does not flash a skeleton.
 */
function useDelayedFlag(active: boolean, delay = 120) {
  const [showing, setShowing] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setShowing(false);
      return;
    }
    const timer = window.setTimeout(() => setShowing(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);

  return showing;
}

export default function App() {
  // Remembers where the reader was browsing, so the create / edit screens can
  // return there once they are saved (see `~/lib/return-to`).
  useBrowsingPageRecorder();

  // A client-side navigation keeps the *previous* page on screen until the new
  // loader data arrives, which reads as "the click did nothing" on a slow
  // round-trip. A skeleton appears if that wait passes a moment, so the click
  // is acknowledged immediately without flashing on fast navigations.
  const navigation = useNavigation();
  const loading = navigation.state === "loading";
  const showSkeleton = useDelayedFlag(loading);

  // Sign-in / sign-up get a distraction-free screen: no sidebar, mobile nav or
  // footer, and the card is centred in the viewport instead of flowing in the
  // content column.
  const { pathname } = useLocation();
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  return (
    <ConvexClientProvider>
      <DeviceSyncPrompt />
      <div className="flex min-h-dvh">
        {!isAuthPage && <Sidebar />}
        <div className="flex min-h-dvh w-full min-w-0 flex-col">
          {!isAuthPage && <MobileNav />}
          <main
            className={cn(
              "w-full flex-1",
              isAuthPage
                ? "flex items-center justify-center px-6 py-10"
                : "px-6 pb-28 pt-8 md:pb-8"
            )}
          >
            {showSkeleton ? <PageSkeleton /> : <Outlet />}
          </main>
          {!isAuthPage && (
            <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
              あああ！ - An open-source Japanese grammar reference with example sentences and English equivalents.
            </footer>
          )}
        </div>
        <Toaster />
      </div>
    </ConvexClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
