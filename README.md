# 日本語Vocab — Japanese Vocabulary App

A full-stack Japanese vocabulary site with a dark-first UI: browse **tagged word lists**,
study flashcards from one or several combined lists, browse **phrases**, and learn
word/sentence grammar rules. Anyone can create word lists, phrase lists and grammar rules —
by hand, or by pasting JSON into the form. Example sentences live on the word or rule they
belong to. Everything is **private to its owner**: signed-out content is scoped to the
device, and signing in syncs it to the account (an onboarding prompt offers a starter pack
of common words, phrases and rules).

**Stack:** React Router v8 (framework mode, TypeScript) · Cloudflare Workers · Cloudflare D1
(SQLite) · Convex Auth (email + password) · Tailwind CSS v4 + Lightswind UI · Framer Motion.

---

## Features

- **Flashcards** (`/study/flashcards`) — a session builder in three independent tabs
  (**Words**, **Phrases**, **Rules**). Pick tags, lists, word types and a deck size; save and
  reload sessions. Spaced repetition is on by default, "Again" cards return later in the same
  session, and cards flip both ways at random. **Space** flips, **←** / **→** answer.
- **Quizzes** (`/study/quizzes`) — the AI counterpart. One quiz can mix words, phrases and
  rules. Choose the question count, an optional per-question timer, the question types
  (multiple choice, type the answer, fill in the blanks, true/false), the difficulty, and
  optionally scope it to what you keep getting wrong. See [AI model chain](#ai-model-chain).
- **Library** — word lists (`/`), words (`/words`), phrases (`/phrases/lists`, `/phrases`),
  grammar rules (`/rules`), plus separate example-sentence browsers for words and for rules.
- **Create & import** — every create page is one form: manual fields, then a *Bulk import from
  JSON* accordion that **fills that form** rather than writing to the database, so you can
  review and edit before saving.
- **Ownership** — every read and write is scoped to the request's owner (a Convex account, or a
  device cookie when signed out). Owners can edit and delete their own rows.
- **Navigation** — desktop side nav; on mobile a bottom dock split into Words / Phrases /
  Grammar / Study / Profile.

## AI model chain

Quiz generation walks an ordered list of models until one returns a usable answer. The list is
`MODEL_CHAIN` in **`app/lib/ai.server.ts`** — that file is the reference for the error taxonomy
and the per-row reasoning; this section is the operator's view of it.

### You only need one key

**The walk skips any provider with no key set**, so a single key is enough to generate quizzes.
Set as many as you have; the chain uses them in order.

| Env var | Provider | Notes |
|---|---|---|
| `MUSECODE_API_KEY` | [Meta Model API](https://api.meta.ai/) | Leads the chain. Its thinking cannot be switched off, so the row carries its own 60s ceiling. |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Four rows, newest first. Has a free tier. |
| `GEMINI_FALLBACK_API_KEY` | same | Optional second key, tried when the primary fails on key or quota grounds. |
| `AIHUBMIX_API_KEY` | [AIHubMix](https://console.aihubmix.com/) | Two rows. The free-trial allowance is small. |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/workspaces/default/keys) | Uses `:free` models. |
| `GROQ_API_KEY` | [Groq](https://console.groq.com/keys) | One row. |
| `NVIDIA_API_KEY` | [NVIDIA NIM](https://build.nvidia.com/) | One row. |
| `COMET_API_KEY` | [CometAPI](https://www.cometapi.com/) | One row. |
| `GLM_API_KEY` | [Z.AI / BigModel](https://z.ai/) | Optional. The key works, but **both GLM rows are parked** — the free tier is too slow for the ceiling. |
| `OPENCODE_API_KEY` | [OpenCode Zen](https://opencode.ai/) | **Paid only, and ships no rows.** See [below](#adding-opencode-zen-rows). |

### Setting a key

```bash
# local development — .dev.vars (git-ignored)
GEMINI_API_KEY=your-key

# production — Worker secret
npx wrangler secret put GEMINI_API_KEY
```

Then regenerate the binding types so `env.*` stays typed:

```bash
npx wrangler types
```

Two rules. **Never prefix a key with `VITE_`** — Vite inlines referenced `VITE_*` values into
the browser bundle, which would hand the key to anyone who opens DevTools. And a key read in
the Worker is a **secret**, not a `wrangler.jsonc` var. `npm run typecheck` runs
`wrangler types` for you, which is why it has to run *after* you edit `.dev.vars`.

### Changing the chain

`MODEL_CHAIN` is mirrored by **`CHAIN_LABELS`** in `app/components/quiz-runner.tsx`. The
loading bar is positional, so a row without a matching label at the same index gets
mislabelled. After any edit:

```bash
npm run chain:parity                        # each row's label must be that row's best match
node scripts/chain-parity.mjs --self-test   # proves the check still catches a swap
```

Adding a **new provider key** also means declaring it in four places in
`.github/workflows/deploy.yml` — the placeholder list, the all-empty guard, the `sync_one` call
and the `env:` block — or CI will not sync it to the Worker.

### Adding OpenCode Zen rows

The `opencode` provider is fully wired — key, endpoint and the OpenAI **Responses** transport —
but `MODEL_CHAIN` ships no rows for it, because it is paid-only and there was no funded key to
measure against. To use it, add a row and a label at the same index:

```ts
// app/lib/ai.server.ts
{ model: "muse-spark-1.3", provider: "opencode", endpoint: "responses" },
```

```ts
// app/components/quiz-runner.tsx
"OpenCode Muse Spark 1.3",
```

Two things to know first. Muse Spark is **`/responses`-only**, which is what `endpoint`
selects — plain chat-completions is not its wire format. And the paid id carries **no
`-contributor` suffix**: that suffix marks the *free* tier, which refuses any client that is not
OpenCode's own and trains on your prompts.

### How failures are handled

- Each attempt gets **25s**; the whole walk gets **95s** across two passes. A row can override
  its own ceiling with `timeoutMs` (the Meta row uses 60s).
- A **timeout is never retried** — one slow model must not get two turns while the rest wait.
- A **rate limit is scoped**. If it says the *account* is out (Gemini's 429, a billing message),
  the provider's remaining rows are skipped. If it only concerns that *model* — AIHubMix and
  OpenRouter meter per model — the walk stays inside the provider.
- The loading panel names the model being tried and explains every skip, so a slow cascade
  never looks like a freeze.

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
`PLACEHOLDER_RUN_WRANGLER_D1_CREATE`), then apply the migrations:

```bash
npx wrangler d1 migrations apply japanese-vocab-db --local    # local dev database
npx wrangler d1 migrations apply japanese-vocab-db --remote   # production
```

### 2. Convex Auth

```bash
npx convex dev
```

The first run logs you in, creates a project and pushes the functions; it generates the real
`convex/_generated/*` files (replacing the checked-in stubs) and prints your deployment URL.

```bash
# .env — the URL npx convex dev printed
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud

# JWT signing key required by Convex Auth
npx convex env set JWT_PRIVATE_KEY "$(openssl genrsa 2048)"
```

### 3. An AI key

See [AI model chain](#ai-model-chain). One key is enough.

> Until `VITE_CONVEX_URL` is set the app browses and studies normally, but the sign-in/sign-up
> pages and the create pages show a "not configured" state.

## Develop

```bash
npm run dev     # http://localhost:5173
```

Local development is wired to the **live** Cloudflare resources, not to copies:

- **D1** — the `DB` binding is `"remote": true` in `wrangler.jsonc`, so `npm run dev` reads
  *and writes* the deployed `japanese-vocab-db`. Anything you create locally shows up on the
  deployed site immediately (and vice versa). Requires `npx wrangler login`.
- **Convex** — `VITE_CONVEX_URL` points at the same deployment the Worker uses, so auth, users
  and authorization are shared too.

To work against a throwaway local database instead:

```bash
CLOUDFLARE_VITE_FORCE_LOCAL=true npm run dev
```

## Deploy

```bash
npm run deploy      # build + wrangler deploy
npx wrangler d1 migrations apply japanese-vocab-db --remote
```

Add `VITE_CONVEX_URL` to the build environment, and enable the Convex site URL:

```bash
npx convex env set CONVEX_SITE_URL https://<worker-name>.<subdomain>.workers.dev
```

Worker secrets are read at **runtime**, so they only need setting once and survive every later
deploy. `.github/workflows/deploy.yml` deploys on push and can sync AI keys from repository
secrets — but note that a **GitHub secret is not a Worker secret**: it only reaches the Worker
when a workflow step runs `wrangler secret put`, and only on a deploy.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Vite + Workers runtime + D1) |
| `npm run build` | Production build |
| `npm run deploy` | Build + deploy to Cloudflare Workers |
| `npm run preview` | Build + preview in the Workers runtime |
| `npm run typecheck` | `wrangler types` + `react-router typegen` + `tsc -b` |
| `npm run cf-typegen` | Regenerate Worker binding types |
| `npm run chain:parity` | Check `CHAIN_LABELS` against `MODEL_CHAIN` |
| `npm run quiz:guard` | Check the question-leak guard against real giveaway shapes |
| `npm run grader:guard` | Check `answersMatch` still grades the way the prompt says it does |
| `npm run test:e2e` | Playwright suite (boots its own dev server on :5199) |
| `npm run test:e2e:changed` | Only the specs affected by files changed since `HEAD` |
| `npm run test:e2e:failed` | Only the specs that failed on the previous run |

## Testing

Playwright specs live in `e2e/` and cover the navigation and its active states, the
word-list/phrase-list split, the create pages and their JSON accordions, the legacy upload
redirects, the rule cards/tags/search, the mobile dock, and the signed-out guards on the
server actions.

```bash
npm run test:e2e            # headless
npm run test:e2e:ui         # interactive
npm run test:e2e -- --list  # list the specs
npm run test:e2e:changed    # only the specs your working tree can affect
npm run test:e2e:failed     # re-run just the previous run's failures
```

The full suite takes ~2.5 minutes on an idle 16-core machine, and the ceiling is the dev
server rather than the worker count: it renders a page in ~80ms when idle and tops out
around 7 pages/s under load, so adding workers past the default buys very little.
`PW_WORKERS=<n> npm run test:e2e` overrides the count. The one large remaining lever is
serving the suite a production build instead of the dev server, which removes Vite's
per-request transform and the unbundled module graph; it is not wired up because
`npm run build` has to be current first, which costs more than the suite saves unless you
are running it repeatedly.

`npm run quiz:guard` covers the one piece of quiz logic that is a tuned heuristic rather than a
rule: `leaksAnswer` in `app/lib/quiz-parse.ts`, which drops a generated question whose answer is
visible in the question itself. Its thresholds exist to avoid dropping *legitimate* questions, and
loosening one has no symptom beyond a quietly shorter quiz — so the check asserts both directions,
and then rebuilds the module with the guard removed to prove the drops were the guard's doing.

`npm run grader:guard` covers the opposite edge: the contract between `answersMatch` in
`app/components/quiz-runner.tsx` and the instructions in `app/lib/quiz-prompt.ts`. The grader forgives
only furigana, `**bold**`, whitespace and a fixed punctuation set — there is no romaji conversion
anywhere in the app, so the input box's promise that "kana or romaji both count" holds only because
the prompt makes the model fill `acceptableAnswers`. Neither side fails loudly when the two drift, so
the check pins the grader's real behaviour and compares the punctuation set in the code against the
one written out in the prompt.

Prerequisites match `npm run dev`, plus a migrated **local** D1 database
(`npx wrangler d1 migrations apply japanese-vocab-db --local`) — the specs assert against the
seeded *Everyday Phrases* list. The suite forces its bindings local
(`CLOUDFLARE_VITE_FORCE_LOCAL=true` in `playwright.config.ts`), so running it never touches the
live database even though `npm run dev` does.

## Project layout

```
app/
  root.tsx                     # layout: side navigation (desktop) + mobile top bar
  routes/                      # index (word lists home), words, phrases, rules, study/*,
                               # lists/*, settings, upload (redirect), login,
                               # signup, logout, api/* (+ api/quiz/generate)
  components/
    sidebar.tsx                # desktop side nav + mobile top bar (dock lives here)
    page-header.tsx            # the one page header every page uses
    study-setup.tsx            # flashcard session builder + save/load drawers
    quiz-setup.tsx             # quiz builder: sources, count, timer, types, difficulty
    quiz-runner.tsx            # quiz session: generation panel, timer, inputs, results
    flashcards.tsx             # 3D flip flashcard deck
    lists-home.tsx             # word/phrase list grid: selection, combined study, tags
    vocab-rows-editor.tsx      # draggable word/phrase rows with meanings + examples
    rule-form.tsx              # rule editor (one panel per rule)
    json-fill-accordion.tsx    # the shared *Fill form from JSON* accordion
    lightswind/                # vendored Lightswind UI components
  lib/
    db.server.ts               # D1 queries (server-only)
    auth.server.ts             # verifies Convex tokens server-side before D1 writes
    ratelimit.server.ts        # Workers rate limiting bindings + fallback
    ai.server.ts               # model fallback chain + error classification (server-only)
    quiz-types.ts              # quiz config + generated-question shapes (client + server)
    quiz-prompt.ts             # builds the generation prompt from library items (pure)
    quiz-parse.ts              # validates/normalises the model's JSON into questions
    vocab.ts                   # shared JSON parsing/validation (tolerant key aliases)
    vocab-rows.ts              # word/phrase rows shared by the client forms and actions
    study-cards.ts             # flattens words/phrases/rules into flashcard StudyCards
    study-prefs.ts             # study config + saved sessions (localStorage)
    rule-draft.ts              # rule drafts: parse pasted JSON + validate
convex/                        # Convex Auth backend (schema, auth, users, stars, quizStats)
migrations/                    # D1 SQL migrations (schema + seed)
workers/app.ts                 # Worker entry
wrangler.jsonc                 # Workers + D1 binding config
```

## Security

- **Auth tokens.** Sign-in uses Convex Auth. The token travels back to server actions in a
  `convexToken` hidden form field, or as `Authorization: Bearer <token>` on the JSON API, and
  every action re-verifies it against Convex before touching D1. It is **not** kept in
  `localStorage`: a custom `TokenStorage` reads and writes it through `/api/auth-token`, which
  stores it in an `HttpOnly`, `SameSite=Lax` cookie, so page scripts can never read it.
- **Access control.** Everything in the library is private to its owner. The root middleware
  resolves the owner for every request — the Convex JWT cookie when signed in, the `jv_device`
  cookie when not — and every D1 query is scoped by that owner id. Every `/api/*` endpoint sits
  behind `guardApiRequest` (per-IP rate limit, then a verified token) and returns only the
  caller's own rows.
- **Response headers.** `workers/app.ts` sets `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, a restrictive `Permissions-Policy` and
  `Strict-Transport-Security` over HTTPS. Nothing uses `dangerouslySetInnerHTML`.
- **Secrets.** `.dev.vars`, `.env.local`, `admin-token.txt`, `signin-*.json` and `*.pem` are
  git-ignored. If any of them were ever shared or committed elsewhere, rotate the Convex deploy
  key and the affected tokens.

## JSON API (restricted + rate limited)

The HTML pages work for everyone (each owner sees only their own rows), but the **JSON API is
limited to registered users** and every endpoint is rate limited with Cloudflare's native
Workers Rate Limiting bindings.

| Endpoint | Auth | Rate limit |
|---|---|---|
| `GET /api` | public metadata only (no data) | 60 req/min per IP |
| `GET /api/lists` | **registered users** | 60 req/min per IP |
| `GET /api/words?q=<search>&page=<n>` | **registered users** | 60 req/min per IP |
| `GET /api/words/:id` | **registered users** | 60 req/min per IP |
| `GET /api/examples?page=<n>` | **registered users** | 60 req/min per IP |
| `POST` form actions (create/upload) | **owner-scoped** | 10 req/min per IP |

Authenticated calls pass the signed-in user's Convex token as a header:

```
Authorization: Bearer <convex-auth-token>
```

Responses: `401` (unauthorized), `429` with a `Retry-After` header (rate limited), `503` when
Convex is not configured, `200` with JSON otherwise. Quiz generation is guarded by a separate,
much smaller limiter (`AI_LIMITER`) because it calls out to the model providers. If a binding
is unavailable (e.g. in tests) an in-memory per-isolate limiter with identical limits is used.

## Vocabulary JSON format

The *Bulk import from JSON* accordion on `/lists/new` accepts a single object or an array, and
tolerates common key aliases (`kanji`→`word`, `reading`→`kana`, `definitions`, `sentences`, …).
An optional **`pos`** tags the part of speech (`n`, `v`, `adj` and friends are normalized),
**`notes`** is free text, and **`forms`** lists conjugation forms:

```json
[
  {
    "word": "図書館",
    "kana": "としょかん",
    "pos": "noun",
    "meanings": ["library"],
    "forms": [{ "name": "ます-form", "value": "図書館に行きます" }],
    "examples": [
      { "japanese": "図書館で本を借りました。", "translation": "I borrowed a book at the library." }
    ]
  }
]
```

Rules take a different shape — each item needs `kind` (`"word"` or `"sentence"`), `title` and
`explanation`; `points` (up to four) and `examples` are optional. A rule example carries **two**
English fields, because they answer different questions:

| Field | Question it answers | Example (`友達に手伝われました`) |
| --- | --- | --- |
| `english` | What does the sentence mean? | "My friend helped me." |
| `englishEquivalent` | How is the same idea *said in English*? | "I was helped by my friend." |

```json
[
  {
    "kind": "word",
    "title": "Polite て-form",
    "points": ["Verb て-form", "Drop ます and add て"],
    "explanation": "The て-form connects clauses and forms requests.",
    "examples": [
      {
        "japanese": "食べてください。",
        "english": "Please eat.",
        "englishEquivalent": "Please eat."
      }
    ]
  }
]
```

## Notes & tradeoffs

- Lightswind UI is a copy-paste component library; the components in
  `app/components/lightswind/` follow its conventions (`cn()`, `lightswind.css` theme
  variables, cva variants). Pull official versions any time with
  `npx lightswind@latest add <component>`.
- Auth lives in Convex (users and sessions are Convex tables); vocabulary content lives in D1.
  `owner_id` stores the Convex user id (signed in) or the device id (signed out) as a plain
  string — no cross-database foreign key. Seeded template rows (`owner_id` NULL) form the
  onboarding starter pack, copied into an owner's namespace when chosen.
- The old `/upload`, `/rules/upload` and `/phrases/upload` URLs still exist but redirect to the
  corresponding *Add* pages, where the manual form and the JSON import live together.
