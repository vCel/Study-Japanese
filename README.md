# 日本語Vocab — Japanese Vocabulary App

A full-stack Japanese vocabulary site with a **dark-first UI** and **side navigation**:
browse **tagged word lists** (the home page), study flashcards from one or several combined
lists, read example sentences, browse **phrases**, and learn word/sentence grammar rules.
Signed-in users can **create word lists by hand** or **paste JSON to fill the form in** on the
same page; list authors can edit their lists and words; **admins** manage the grammar rules
and can fill their panels from JSON the same way.

**Stack:** React Router v8 (Remix successor, framework mode, TypeScript) · Cloudflare Workers ·
Cloudflare D1 (SQLite) · Convex Auth (email + password) · Tailwind CSS v4 + Lightswind UI ·
Framer Motion.

---

## Studying

- The **Study** page in the nav is a session builder split by a Lightswind **Tabs** component
  into three **independent** sections: **Words**, **Phrases** and **Forms**. Each tab owns its
  own selection *and* its own saved sessions, so switching tabs never mixes decks up.
  - **Words** — pick **tags**, narrow to specific **word lists**, choose **types of words**
    (nouns / verbs / adjectives / adverbs / all) and a **deck size** (10–100).
  - **Phrases** — the same, but over **phrase lists** (no part-of-speech step).
  - **Rules** — drill admin-managed grammar rules, filtered by **rule type** and **tags**.
- **Saving a session:** the **Save session** button opens a Lightswind **Drawer** with a form
  (session name + save). **Load** opens a drawer containing a Lightswind **Scroll Area** with a
  **draggable reorder list** — drag the grip to reorder, tap a session to load it, ✕ to delete.
- Every "Study" button on the word/phrase-list pages pre-fills the matching tab
  (`/study/session?...` runs the flashcards; a deep link without a `kind` infers the section
  from what the selected lists contain).
- **Spaced repetition mode (on by default):** the app tracks which cards you answer "Again"
  on (persisted per browser via localStorage). Due cards are prioritized, "Again" cards
  come back a few positions later in the same session, and the card shows how many times
  you've missed it before.
- **Randomized card side:** each card randomly shows the Japanese term or the meaning
  first, so you practice recall in both directions. Every source is flattened into a
  `StudyCard` (`app/lib/study-cards.ts`), so one `Flashcards` component drills them all.
- Keyboard: **Space** flips, **←** = Again, **→** = Got it.

## App structure

- **Side navigation** (desktop) / top bar (mobile) is grouped into four sections —
  **Word library** (Word lists, Words, Examples), **Phrases** (Phrase lists, Phrases),
  **文法 · Grammar** (Rules & forms, Rule examples) and **Study**. The bottom of the sidebar
  shows your **sign-in state** — signed-in users see their name and a cog button linking to
  `/settings` (there is no upload link there; adding and importing all happen on the
  dedicated create pages).
- **Home (`/`) = Word lists**: filter by tag (input + a **Tags** popover of clickable
  chips), per-list **Study** buttons, and multi-select checkboxes — pick several lists and
  hit **Study** in the action bar to combine them into one flashcard session
  (`/study?lists=1,2,3`). The header holds a single **Add word list** button (`/lists/new`).
  Phrase lists are excluded here.
- **`/words`, `/words/:id`** — searchable vocabulary with meanings, examples and list links
  (phrases are excluded here; they live in the Phrases section).
- **`/phrases/lists`** — **phrase lists** (word lists whose entries are phrases), with the
  same tag filter, per-list study buttons and multi-select. The seeded *Everyday Phrases*
  list lives here.
- **`/phrases`, `/phrases/new`** — every phrase and its detail page; signed-in users add
  phrases by hand or bulk-import them from JSON on the same page. Giving a phrase list
  title groups the phrases into a new list; leaving it blank adds standalone phrases.
- **`/words/examples`** — all word example sentences in reading mode (`/examples` redirects here).
- **`/lists/:id`** — list detail with a *Study this list* button; authors can edit the list.
- **`/lists/new`** — signed-in users create a word list: title, description, tags and
  draggable word rows (each with word, kana, part of speech, every meaning and example
  sentences), **or** expand the *Bulk import from JSON* accordion and press *Fill form from
  JSON* to populate those rows — the JSON is never submitted itself.
- **`/rules`** — admin-managed word/sentence grammar rules with bilingual examples; admins
  see an **Add rule** button (`/rules/new`). One submission can hold **many rules**: the create
  page keeps one editable panel per rule (collapsible, with *Add rule* / *Remove*), and the
  *Bulk import from JSON* accordion **fills those panels** rather than writing rows straight to
  the database. The panel is the only surface — the fields inside it are separated by dividers
  (the edit page, which stands alone, still uses cards per field group). Each card leads with
  the title and shows the rule type beside it, its **ポイント** lines in dashed callouts
  (up to four per rule, added with *Add point*), and
  its example count at the bottom-left. Rules are **tagged** (at most two chips per card, the
  rest collapse into `+x`) and the page has a free-text **search** over
  title/explanation/points plus a tag filter.
- **`/rules/examples`** — every rule/grammar example sentence in one place, each linking back
  to its rule. Kept separate from `/words/examples`, which only lists **word-list** examples.
- **`/rules/:id`** — rule detail: the explanation card holds the explanation *and* its
  ポイント callouts, then examples, an **English equivalents** section, and a **Related
  rules** section (only the rules an admin linked by hand, see below).
- **Edit pages** (`/lists/:id/edit`, `/words/:id/edit`, `/rules/:id/edit`) keep the same
  structure as their detail page with the text swapped for inputs, and are as wide as their
  *Add* counterpart (no narrow column). Repeatable lists — word meanings, word examples and
  rule examples — use the Lightswind **draggable reorder list** (made drag-only from a grip
  handle so the inputs stay usable). Authors and admins also get a **Delete** button in the
  page header that asks to confirm before removing the record.
- **Forms** use the Lightswind **Select** (`app/components/select-field.tsx` wraps it for
  `Form` usage by mirroring the value into a hidden input), the Lightswind **Textarea** for
  long text, right-aligned primary buttons, and raise a Lightswind **toast** whenever
  something is created, edited, deleted or rejected.
- **Mobile navigation** is a bottom Lightswind **Dock** (`/components/lightswind/dock.tsx`)
  split into five **categories** — Words, Phrases, Grammar, Study and Profile — so nothing is
  squeezed off a phone screen. Tapping a category opens a popover **anchored to that button**
  (clamped so the outer ones stay on screen) listing its pages; one-page categories such as
  Study link straight through. The active category is marked with `aria-current`, and `Escape`
  / an outside tap dismisses the menu. The **Profile** menu is auth-aware — a visitor gets
  *Sign in* / *Sign up* and never a sign-out link, a signed-in user gets *Settings* / *Sign out*.
  The top bar keeps the logo on one line and shows the
  account name next to the settings cog (`<AuthButtons layout="header" />`). The desktop
  sidebar is unchanged.
- **`/settings`** — account info (username / email), a **spaced-repetition** preference
  toggle (stored per browser, same setting the study session builder uses), and sign-out.

> The old `/upload`, `/rules/upload` and `/phrases/upload` URLs still exist but redirect to
> the corresponding *Add* pages, where the manual form and the JSON import live together.

## Creating content

Every create page is **one form**: the manual fields on top, then the collapsible
**Bulk import from JSON** accordion (Lightswind `Accordion`) — with a large textarea, optional
file picker and an **animated copy button** that copies the example JSON — and finally the
button row with **Fill form from JSON** (outline) next to the primary *Create …*. Because it is
a single form, importing reuses the page's own title/tags/description instead of asking for
them twice. Fields use the Lightswind **Select** and **Textarea**, the primary button sits at
the right edge, and submitting raises a success (or error) **toast**.

**Importing never writes.** On every page *Fill form from JSON* parses the pasted JSON on the
client and populates the form's own fields, so you can review and edit what you imported before
saving; the JSON action is a `type="button"`, so it never triggers the browser's native
"please fill in this field" validation either:

- **Word & phrase lists** — `app/lib/vocab-rows.ts` turns the JSON into **draggable rows**
  (`app/components/vocab-rows-editor.tsx`), one per entry, each keeping *all* meanings and
  example sentences plus the kana reading and part of speech (phrases are forced to `phrase`).
  The single submit then creates the list and its entries together.
- **Rules** — `app/lib/rule-draft.ts` turns each entry into an editable accordion panel. The
  same validation runs on both sides, and nothing is written until you press *Create N rules*.

The shared plumbing for that is `app/components/json-fill-accordion.tsx` (textarea + fill
button + success/error messaging) over `app/components/json-import.tsx`.

## Testing

End-to-end tests (Playwright) live in `e2e/` and cover the sidebar sections and their active
states, the word-list / phrase-list split, the phrase pages, all three create pages and their
JSON accordions (including the copy-example button, filling the form from JSON on every page,
and the row/panel focus + panel-resize regressions), the legacy upload redirects, the rule
cards/tags/search, the mobile dock categories and their popovers, the custom selects, toasts,
delete confirms, the study tabs with their save/load drawers, and the signed-out guards on the
server actions.

```bash
npm run test:e2e            # headless; boots its own dev server on :5199
npm run test:e2e:ui         # interactive UI mode
npm run test:e2e -- --list  # list the specs
```

Prerequisites match `npm run dev`: `.env.local` with the Convex vars, and a **migrated +
seeded local D1** database (`npx wrangler d1 migrations apply japanese-vocab-db --local`) —
the specs assert against the seeded *Everyday Phrases* list. The suite forces those
bindings local (`CLOUDFLARE_VITE_FORCE_LOCAL=true` in `playwright.config.ts`), so running
the tests never touches the live database even though `npm run dev` does.

The suite starts its own dev server on port `5199` (see `e2e/test-config.ts`) so it never
clashes with a dev server you already have open, and `e2e/global-setup.ts` warms Vite up
before the first test. The create pages are **client-rendered** (they show an "auth not
configured" fallback until the Convex client exists in the browser), so specs on those pages
navigate through the `gotoHydrated` helper in `e2e/helpers.ts`. Specs that *click* before the
page has hydrated go through `waitForHydration`, which waits for React to adopt the
server-rendered DOM — clicks dispatched earlier are silently dropped by the browser.

## Project layout

```
app/
  root.tsx                     # layout: side navigation (desktop) + mobile top bar
  routes.ts                    # route config
  routes/                      # index (word lists home), words, phrases (+ phrases/lists),
                               # study, examples, lists/:id, lists/new, rules/*
                               # (+ rules/examples), settings, upload (redirect),
                               # login, signup, logout, api/*
  components/
    sidebar.tsx                # desktop side nav + mobile top bar (dock lives here)
    page-header.tsx            # the one page header every page uses (fixed height)
    form-message.tsx           # shared inline success / error banner
    json-import.tsx            # BulkImportAccordion + JsonImportField (copy example JSON)
    json-fill-accordion.tsx    # the shared *Fill form from JSON* accordion (never submits)
    vocab-rows-editor.tsx      # draggable word/phrase rows with meanings + examples
    study-setup.tsx            # study tabs (words / phrases / forms) + save & load drawers
    rule-point.tsx             # the dashed ポイント callout (one per rule point)
    select-field.tsx           # Lightswind Select wrapped for <Form> usage
    delete-button.tsx          # Delete + Lightswind Alert Dialog confirm (submits the form)
    profile-menu-items.tsx     # auth-aware dock Profile menu (sign in/up vs settings/out)
    action-toast.ts            # useActionToast() — toast on create/edit/delete results
    flashcards.tsx             # 3D flip flashcard deck (drills any StudyCard)
    lists-home.tsx             # word/phrase list grid: selection, combined study, tag links
    convex-provider.tsx        # ConvexReactClient + ConvexAuthProvider (no-op until configured)
    lists-new-form.tsx         # word-list creation (row editor + JSON fill accordion)
    phrase-form.tsx            # phrase creation (row editor + JSON fill accordion)
    rule-form.tsx              # admin rule editor (one panel per rule, flat fields inside)
    auth-buttons.tsx           # sidebar sign-in area (name + settings cog when signed in)
    lightswind/                # Lightswind UI components (accordion, alert dialog, breadcrumb,
                               # dock, drawer, reorder, tabs, scroll area, animated copy button,
                               # select, button, card, badge, input, pagination, toast)
  lib/
    db.server.ts               # D1 queries (server-only)
    auth.server.ts             # verifies Convex tokens server-side before D1 writes
    ratelimit.server.ts        # Workers rate limiting bindings + fallback
    vocab.ts                   # shared JSON parsing/validation (tolerant key aliases)
    vocab-rows.ts              # word/phrase rows shared by the client forms and the actions
    tags.ts                    # shared tag parsing (comma-separated or array)
    study-prefs.ts             # study config + saved sessions (localStorage, per tab)
    study-cards.ts             # flattens words/phrases/rules into flashcard StudyCards
    rule-draft.ts              # rule drafts: parse pasted JSON + validate (shared client/server)
convex/                        # Convex Auth backend (schema, auth, http, users)
migrations/                    # D1 SQL migrations (schema + seed)
workers/app.ts                 # Worker entry
wrangler.jsonc                 # Workers + D1 binding config
```

## Prerequisites

- Node.js 20+
- A Cloudflare account (free) — for Workers + D1
- A Convex account (free) — for authentication

## Setup

```bash
npm install
```

### 1. Cloudflare D1

```bash
npx wrangler login
npx wrangler d1 create japanese-vocab-db
```

Paste the returned `database_id` into `wrangler.jsonc` (replace
`PLACEHOLDER_RUN_WRANGLER_D1_CREATE`), then apply migrations:

```bash
npx wrangler d1 migrations apply japanese-vocab-db --local   # local dev database
npx wrangler d1 migrations apply japanese-vocab-db --remote  # production database (after deploy)
```

### 2. Convex Auth

```bash
npm i -g convex        # or use npx
npx convex dev         # first run: log in, create a project, push functions
```

`npx convex dev` generates the real `convex/_generated/*` files (replacing the checked-in
stubs) and prints your deployment URL. Then set the required env vars:

```bash
# the URL `npx convex dev` printed, e.g. https://swift-motmot-123.convex.cloud
# put it in .env (see .env.example):
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud

# JWT signing key required by Convex Auth:
npx convex env set JWT_PRIVATE_KEY "<paste output of: openssl genrsa -out key.pem 2048 && cat key.pem>"
```

> Until `VITE_CONVEX_URL` is set, the app runs normally for browsing/studying, but
> sign-in/sign-up pages and the upload form show a "not configured" state.

## Develop

```bash
npm run dev
```

The app runs at http://localhost:5173. Local development is wired to the **live
Cloudflare resources**, not to copies:

- **D1** — the `DB` binding has `"remote": true` in `wrangler.jsonc`, so
  `npm run dev` reads *and writes* the deployed `japanese-vocab-db` database.
  Anything you create locally shows up on the deployed site immediately (and
  vice versa); there is no local seed data and no local database to keep in
  sync. Requires an authenticated Wrangler session (`npx wrangler login`).
- **Convex** — `VITE_CONVEX_URL` in `.env.local` points at the same Convex
  deployment the deployed Worker was built with, so auth, users and upload
  authorization are shared too.

To work against a throwaway local database instead, start the dev server with
`CLOUDFLARE_VITE_FORCE_LOCAL=true npm run dev` (that is what the Playwright
suite does — see below).

## Deploy

```bash
npm run build && npm run deploy     # or: npx wrangler deploy
npx wrangler d1 migrations apply japanese-vocab-db --remote
```

Remember to add `VITE_CONVEX_URL` to your build environment (and re-run `npx convex dev`
or `npx convex deploy` for the Convex backend). Also enable the Convex site URL:
`npx convex env set CONVEX_SITE_URL https://<worker-name>.<subdomain>.workers.dev`.

## JSON API (restricted + rate limited)

The HTML pages are public, but the **JSON API is limited to registered users** and every
endpoint is rate limited with Cloudflare's native Workers Rate Limiting bindings.

| Endpoint | Auth | Rate limit |
|---|---|---|
| `GET /api` | public metadata only (no data) | 60 req/min per IP |
| `GET /api/lists` | **registered users** | 60 req/min per IP |
| `GET /api/words?q=<search>&page=<n>` | **registered users** | 60 req/min per IP |
| `GET /api/words/:id` | **registered users** | 60 req/min per IP |
| `GET /api/examples?page=<n>` | **registered users** | 60 req/min per IP |
| `POST /upload` (form action) | **registered users** | 10 req/min per IP **and** per user |
| `POST /lists/new` (form action) | **registered users** | 10 req/min per IP |
| `POST /rules/upload` (form action) | **admins** | 10 req/min per IP |

Authenticated calls pass the signed-in user's Convex token as a header:

```
Authorization: Bearer <convex-auth-token>
```

Responses: `401` (unauthorized), `429` with a `Retry-After` header (rate limited), `503`
when Convex is not configured, and `200` with JSON otherwise. The upload action is rate
limited twice — per client IP and per user account — and returns a friendly error in the
form when throttled.

Rate limiting is enforced by the `API_LIMITER` / `UPLOAD_LIMITER` bindings in
`wrangler.jsonc` (`simple: { limit, period }`). If a binding is unavailable (e.g. unit
tests), an in-memory per-isolate limiter with identical limits is used as a fallback.

## Word lists & tags

- Every JSON import creates a **new word list** — the upload form requires a **title**
  (plus optional description and comma-separated **tags**, normalized to lowercase,
  max 10 × 32 chars).
- Browse lists at `/lists` (tag badges + word counts) and inspect a list at
  `/lists/:id`; word cards and word detail pages link back to their list.
- Tags live in a `tags` table with a `word_list_tags` join table, so the same tag can be
  reused across lists. Words get `words.list_id`; deleting a list detaches its words
  (`ON DELETE SET NULL`), it does not delete them.

### Filtering by tag

Every list page filters the same way (`SearchBar` + `ActiveTagFilter` in
`app/components/search-bar.tsx`): pick a tag from the **Tags** popover, from a card's tag
chip, or by typing one into the search box — the active tag is then shown as a **chip**
under the search bar (`#jlpt ✕`), never as text inside the input. The chip clears the tag
but keeps the part-of-speech filter, and the popover's chips keep you on the page you are
browsing: `/phrases/lists` links to `/phrases/lists?tag=…`, not back to the word lists, and
a phrase list's own tag links on `/lists/:id` do the same. `/rules` uses the identical chip.

## Rules & forms (admin-only, separate nav section)

The **"Rules & forms"** section in the navigation (visually separated, labelled 文法)
covers **word rules/forms** and **sentence rules** — each with a title, up to four
**points** (ポイント lines describing the pattern), an explanation, and examples that pair a
**Japanese sentence with its English equivalent**.

- `/rules` — browse all rules, filterable by kind (All / Word rules / Sentence rules)
- `/rules/:id` — rule detail with examples + English equivalents
- `/rules/new`, `/rules/:id/edit` — **admin-only** create/edit forms. A rule shows one
  dashed ポイント callout per point (start with one, then *Add point* up to four; each has
  its own remove control once there is more than one), plus a **Related rules** picker:
  related rules are **curated by hand** (chosen from a dropdown of the other rules, shown as
  removable chips) and stored in the `rule_related` join table — nothing is ever inferred
  from tags or wording. Only linked rules appear in the detail page's *Related rules* card.
- `/rules/upload` — **admin-only** bulk import: paste an array of rule objects (same shape
  as the create form). Each item needs `kind` (`"word"` or `"sentence"`), `title` and
  `explanation`; `points` (up to four strings) and `examples` are optional. A legacy
  single `pattern` string is still accepted and becomes the first point:

  ```json
  [
    {
      "kind": "word",
      "title": "Polite て-form",
      "points": ["Verb て-form", "Drop ます and add て"],
      "explanation": "The て-form connects clauses and forms requests.",
      "examples": [{ "japanese": "食べてください。", "english": "Please eat." }]
    }
  ]
  ```

**Admin setup:** admins are allow-listed by email through a Convex deployment env var:

```bash
npx convex env set ADMIN_EMAILS "you@example.com,second-admin@example.com"
```

The `isCurrentUserAdmin` Convex query is the single source of truth: the UI (via
`AdminOnly`) hides the *Add rule* / *Edit rule* buttons from everyone else, and the
server actions (`guardAdminAction`) re-verify the Convex token + admin allow-list before
touching D1 — returning 401/403/429/503 as appropriate. Rules management also shares the
write rate limit (10 req/min per IP). Form posts don't set an `Authorization` header, so the
actions pass the Convex token from the form body (`readFormToken(form)`) into the guard; the
header is still honoured for the JSON API.

## Editing (author only)

- The **author of a word list** can edit its title, description and tags at
  `/lists/:id/edit` (the list detail page shows an *Edit list* button only to them).
- The **list author** (or the original creator of a standalone word) can edit word
  information — word, kana, meanings, and add/remove/edit example sentences — at
  `/words/:id/edit` (*Edit word* button on the word detail page).
- Every edit action verifies the Convex token server-side and checks authorship before
  touching D1; everyone else gets a 403-style message. Edit actions share the upload
  rate limit (10 req/min).
- **Delete** sits next to *Save changes* in the action row and asks for confirmation in a
  Lightswind **Alert Dialog** before anything happens. The confirm button submits the same
  edit form with `action=delete` (via the HTML `form` attribute, so no nested forms), and the
  route action re-checks permissions before deleting.
- Nobody who is signed out sees a create or edit control: the *Add* buttons, the per-page
  empty-state links and the edit buttons are all behind an auth gate (`SignedInOnly` /
  `SignedInOnlyClient`, `AdminOnly`, `CanEdit`).

> Navigation between levels is by **breadcrumb** (Lightswind `Breadcrumb`, rendered by
> `PageHeader`) rather than back buttons, so the trail is the same wherever you are.

### One page header everywhere

`PageHeader` (`app/components/page-header.tsx`) is the **only** header in the app, and every
page renders it — lists, detail pages, forms, study and settings alike — in the same shape:

1. the title (`text-3xl`, with an optional leading icon and a badge to its right) on the left
   and the page's action buttons on the right (`justify-between`),
2. a one-line subtitle, directly under the title,
3. the breadcrumb trail, which opens the body rather than sitting above the title.

Nothing is conditional about the shell around those rows, so the top of the content is the
same height (and the same shape) on every page: moving from `/words` into a word, a phrase
or `/rules/new` never shifts the layout. The subtitle is clamped to one line, and pages with
neither a subtitle nor a trail still reserve both rows. Playwright guards this —
`e2e/pages.spec.ts` measures the header across fourteen pages, asserts a single height and
checks the order (title above subtitle above trail), and `e2e/create-pages.spec.ts` does the
same for the three create pages.

A new page should therefore render `<PageHeader>` rather than its own `<h1>`, passing
`breadcrumbs`, `badge`, `actions` and `description`.

### Breadcrumbs

The trail is `previous › current`: `PageHeader` takes the **ancestors** and appends the
page's own `title` as the final, non-navigable crumb. `/rules/new` therefore passes
`breadcrumbs={[{ label: "Rules & forms", to: "/rules" }]}` and renders
`Rules & forms › Add rule`; a nested page like `/lists/1/edit` passes two ancestors and
renders `Word lists › JLPT N5 Starter › Edit word list`. Top-level pages (where the first
crumb would be the page itself) pass nothing and get no trail.

`app/components/lightswind/breadcrumb.tsx` is the Lightswind breadcrumb
(<https://lightswind.com/components/breadcrumb>), adapted so `BreadcrumbLink` takes a React
Router `to` instead of an `href`. It exports `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`,
`BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator` and `BreadcrumbEllipsis`, and is
used through `PageHeader`'s `breadcrumbs` prop rather than directly. Because it renders a
`<nav aria-label="breadcrumb">` (and the sidebar nav is `aria-label="Primary"`), tests should
scope with `getByRole("navigation", { name: … })` rather than a bare `getByRole("navigation")`.

## Security

- **Auth tokens.** Sign-in uses Convex Auth. The token is held in the browser and travels
  back to the React Router actions in the `convexToken` hidden form field (or as
  `Authorization: Bearer <token>` on the JSON API). Every action re-verifies it against
  Convex before touching D1, so a tampered client cannot write. The Convex Auth JWT / refresh
  token is **not** kept in `localStorage`: `ConvexAuthProvider` is given a custom
  `TokenStorage` (`app/components/convex-provider.tsx`) that reads and writes through
  `/api/auth-token` (`app/routes/api.auth-token.ts`), which stores each token in an
  `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS). Page scripts can therefore never
  read the credentials.
- **Response headers.** `workers/app.ts` adds `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin`, a restrictive `Permissions-Policy`, and
  `Strict-Transport-Security` over HTTPS. Nothing in the app uses
  `dangerouslySetInnerHTML`, so there is no HTML-injection sink for stealing the token.
- **Access control.** Browsing vocabulary, examples and rules is public by design. Writing
  is not: `guardAdminAction` (rules) and the ownership checks on words/lists verify the
  Convex token *and* the owner/admin allow-list **server-side** — the UI gates
  (`AdminOnly`, `CanEdit`, `SignedInOnly`) are cosmetic. Every `/api/*` endpoint sits behind
  `guardApiRequest` (per-IP rate limit, then a verified token), and the four data endpoints
  return the same public catalogue the site already shows. On the Convex side only
  `getAuthenticatedUser` (your own account) and `isCurrentUserAdmin` (a boolean) are public
  queries; the username/email lookups are `internal*`.
- **Secrets.** `.env.local`, `admin-token.txt`, `signin-*.json` and `*.pem` are git-ignored.
  If any of them were ever shared or committed elsewhere, rotate the Convex deploy key and
  the affected tokens.

## Vocabulary JSON format

Both a **file upload** and **pasted text** are accepted on `/upload` (each import becomes a
new titled word list). A single object or an array works, and common key aliases are
tolerated (`kanji`→`word`, `reading`→`kana`, `definitions`, `sentences`, …). An optional
**`pos`** field tags the part of speech — noun, verb, adjective, adverb, expression,
particle (synonyms like `n`, `v`, `adj` are normalized):

```json
[
  {
    "word": "図書館",
    "kana": "としょかん",
    "pos": "noun",
    "meanings": ["library"],
    "examples": [
      { "japanese": "図書館で本を借りました。", "translation": "I borrowed a book at the library." }
    ]
  }
]
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Vite + Workers runtime + local D1) |
| `npm run build` | Production build |
| `npm run deploy` | Build + deploy to Cloudflare Workers |
| `npm run preview` | Build + preview in the Workers runtime |
| `npm run typecheck` | `wrangler types` + `react-router typegen` + `tsc -b` |
| `npm run cf-typegen` | Regenerate Worker binding types from `wrangler.jsonc` |

## Notes & tradeoffs

- Lightswind UI is a copy-paste component library; the components in
  `app/components/lightswind/` follow its documented conventions (`cn()` utility,
  `lightswind.css` theme variables, cva variants). You can pull official versions any time
  with `npx lightswind@latest add <component>`.
- Auth lives in Convex (users + sessions are Convex tables). Vocabulary content lives in
  D1; every upload is authorized by verifying the client's Convex token server-side before
  writing to D1 (`app/lib/auth.server.ts` → `convex/users.ts`).
- `created_by` stores the Convex user id as a plain string (no cross-database FK).