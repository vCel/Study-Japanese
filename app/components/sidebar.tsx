import { Link, useLocation } from "react-router";
import {
  BookOpenText,
  CircleHelp,
  GraduationCap,
  Layers,
  ListTree,
  LogIn,
  LogOut,
  MessageSquareQuote,
  Settings,
  Sparkles,
  User,
  UserPlus,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { AuthButtons } from "~/components/auth-buttons";
import { ProfileMenuItems } from "~/components/profile-menu-items";
import { Dock } from "~/components/lightswind/dock";

/** Word library: word lists, words and their example sentences. */
const WORD_LIBRARY_LINKS = [
  { to: "/", label: "Word lists", icon: ListTree },
  { to: "/words", label: "Words", icon: Layers },
  { to: "/words/examples", label: "Examples", icon: BookOpenText },
];

/** Phrases: phrase lists and the phrases they contain. */
const PHRASE_LINKS = [
  { to: "/phrases/lists", label: "Phrase lists", icon: ListTree },
  { to: "/phrases", label: "Phrases", icon: MessageSquareQuote },
];

/**
 * Study: flashcards plus the quizzes placeholder. Two entries, so the mobile
 * dock — which reuses this list — opens a popover for the category instead of
 * linking straight through.
 */
const STUDY_LINKS = [
  { to: "/study/flashcards", label: "Flashcards", icon: GraduationCap },
  { to: "/study/quizzes", label: "Quizzes", icon: CircleHelp },
];

/** Separate section for word/sentence rules & forms. */
const RULE_LINKS = [
  { to: "/rules", label: "Rules & forms", icon: Sparkles },
  { to: "/rules/examples", label: "Rule examples", icon: BookOpenText },
];

const SECTIONS = [
  { title: "Word library", links: WORD_LIBRARY_LINKS },
  { title: "Phrases", links: PHRASE_LINKS },
  { title: "文法 · Grammar", links: RULE_LINKS },
  { title: "Study", links: STUDY_LINKS },
];

const ALL_LINKS = [...WORD_LIBRARY_LINKS, ...PHRASE_LINKS, ...STUDY_LINKS, ...RULE_LINKS];

/**
 * Account pages — used only to mark the Profile category active; the popover
 * body is the auth-aware `ProfileMenuItems` (so signed-out visitors never see
 * a sign-out link).
 */
const PROFILE_LINKS = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/login", label: "Sign in", icon: LogIn },
  { to: "/signup", label: "Sign up", icon: UserPlus },
  { to: "/logout", label: "Sign out", icon: LogOut },
];

const ALL_LINKS_WITH_PROFILE = [...ALL_LINKS, ...PROFILE_LINKS];

/**
 * Dock categories. The mobile dock shows one button per category and opens a
 * popover with that category's pages, so nothing is squeezed off-screen.
 */
const DOCK_CATEGORIES = [
  { key: "words", label: "Words", icon: Layers, links: WORD_LIBRARY_LINKS },
  { key: "phrases", label: "Phrases", icon: MessageSquareQuote, links: PHRASE_LINKS },
  { key: "grammar", label: "Grammar", icon: Sparkles, links: RULE_LINKS },
  { key: "study", label: "Study", icon: GraduationCap, links: STUDY_LINKS },
  {
    key: "profile",
    label: "Profile",
    icon: User,
    links: PROFILE_LINKS,
    content: <ProfileMenuItems />,
  },
];

function matches(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

/** A link is active when it matches and no more specific link also matches. */
function isActive(
  pathname: string,
  to: string,
  links: { to: string }[] = ALL_LINKS
) {
  if (!matches(pathname, to)) return false;
  return !links.some(
    (link) => link.to !== to && link.to.length > to.length && matches(pathname, link.to)
  );
}

function NavLinkItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Layers }) {
  const { pathname } = useLocation();
  const active = isActive(pathname, to);
  return (
    <Link
      to={to}
      // Prefetch on hover/focus: the route module and its loader data are
      // already there by the time the click lands, so switching pages does not
      // wait for a round-trip. Only the intent case — no viewport prefetching,
      // which would fire a request for every link on the page.
      prefetch="intent"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-full px-4 py-2.5 text-base font-medium transition-colors",
        active
          ? "bg-primarylw/15 text-primarylw"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className={cn("h-5 w-5", active && "text-primarylw")} />
      {label}
    </Link>
  );
}

function Logo() {
  return (
    <Link to="/" prefetch="intent" className="flex shrink-0 items-center gap-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primarylw text-lg font-bold text-white">
        あ
      </span>
      <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
        あああ<span className="text-primarylw">！</span>
      </span>
    </Link>
  );
}

function NavSections() {
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-6 px-3">
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
            {section.title}
          </p>
          <div className="space-y-1">
            {section.links.map((link) => (
              <NavLinkItem key={link.to} {...link} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Desktop side navigation. */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border/60 bg-card/50 py-6 md:flex">
      <div className="mb-10 px-5">
        <Logo />
      </div>
      <NavSections />
      {/* Signed in, the account row brings its own pill (see AuthButtons); signed
          out, the two buttons stay flush so neither gets squeezed. */}
      <div className="mt-6 px-3">
        <AuthButtons />
      </div>
    </aside>
  );
}

/** Compact top bar plus a category dock for small screens. */
export function MobileNav() {
  const { pathname } = useLocation();
  const dockItems = DOCK_CATEGORIES.map((category) => ({
    ...category,
    active: category.links.some((link) =>
      isActive(pathname, link.to, ALL_LINKS_WITH_PROFILE)
    ),
  }));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl md:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Logo />
          <AuthButtons layout="header" />
        </div>
      </header>
      <Dock categories={dockItems} />
    </>
  );
}