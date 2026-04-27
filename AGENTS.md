# Tale — coding standards

The single contract for writing code in this repository. Read this file in full before your first change. Documentation rules live in [`docs/AGENTS.md`](docs/AGENTS.md); cross-locale terminology in [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md).

Tale is a monorepo on Bun workspaces (`@tale/platform`, `@tale/cli`, `@tale/crawler`, `@tale/rag`, `@tale/db`, `@tale/proxy`, `@tale/docs`). Every script runs through the workspace filter:

```bash
bun run --filter @tale/<workspace> <script>
```

## Before you open a PR

This is the first thing you check, not the last. Skipping the docs/translations sync is the most common failure mode for agent-authored PRs in this repo — every rule below is here because it was skipped before.

### Does this change need docs and translations?

Walk top-down. First **yes** wins.

- Did you add, rename, or remove a key in `services/platform/messages/`? → **Yes.**
- Did you add, change, or remove a UI element a user can click, see, or read? → **Yes.**
- Did you add, rename, remove, or change the default of an env var, CLI flag, config file key, or API field? → **Yes.**
- Did you change error wording, validation rules, or rate limits a user can hit? → **Yes.**
- Pure refactor, internal type, test, build script, or comment? → **No.** Note the scope in the commit body.

If unsure, default to **yes**. Reviewer time is cheaper than stale docs.

### Pre-PR checklist

Paste this into the PR description. Empty boxes get rejected.

- [ ] Ran `bun run check` (format, lint, typecheck, all tests).
- [ ] Updated `services/platform/messages/{en,de,fr}.json` — or N/A.
- [ ] Updated `docs/{,de/,fr/}` for every user-visible change — or N/A.
- [ ] Ran `bun run --filter @tale/docs lint` — or N/A.
- [ ] Updated [`README.md`](README.md), [`README.de.md`](README.de.md), [`README.fr.md`](README.fr.md) — or N/A.

## Non-negotiable rules

These hold across every workspace and language. They are not style preferences.

- **Never destroy state without explicit permission.** Local databases, Convex state, caches, config files, branded seed data — ask before wiping. Assume every file on disk may be the user's in-progress work.
- **Never hardcode secrets or credentials.** Environment variables only. Scrub logs before committing.
- **Validate at every system boundary.** User input, external APIs, webhook payloads. Parameterized queries only; never string-concatenate SQL or shell.
- **Docs and translations ship with the code.** If a change alters what a user sees, configures, or calls, the same PR updates `docs/` in all three locales (`en`, `de`, `fr`) and every key in `en.json` exists in `de.json` and `fr.json` on the same commit. Variant files (`de-AT`, `de-CH`, `fr-CH`) only hold overrides.
- **Accessibility is Level AA, not a nice-to-have.** Real HTML elements, keyboard reachability, visible focus, labelled controls, AA contrast.

## Code style

- **Filenames:** dash-case everywhere except Convex and Python, which use snake_case.
- **No status comments.** `// REFACTORED`, `// ✅ removed`, `// TODO: see #123` are noise. Write self-documenting code; put context in the commit message or PR.
- **No comments explaining what was removed.** Removed code is gone; git log is the record.
- **Comments explain _why_, rarely _what_.** If a well-named identifier already tells the reader what, you are writing redundant prose.
- **No empty catch blocks.** Log with `console.warn` / `console.error` or re-throw. Silent catches hide real bugs.
- **No locale-aware date methods.** `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` are banned. Use `useFormatDate()` in React or `formatDate()` from `lib/utils/date/format`.

## Security

Security is a first pass, not a clean-up step. During every change, check the OWASP top 10 apply: command injection, XSS, SQL injection, SSRF, auth bypass, IDOR, deserialization. If you introduce code that touches a boundary (request handler, file system, shell), assume adversarial input and prove it is safe.

## Git and commits

- **Scope and type:** see [`commitlint.config.mjs`](commitlint.config.mjs) for the allowed set.
- **Header ≤72 characters.** The header becomes the PR title; longer truncates on GitHub.
- **Lowercase description, no trailing period.** `feat(platform): add arena mode` — not `feat(Platform): Add Arena Mode.`.
- **Atomic commits.** One logical change per commit. If the message needs "and", it should probably be two commits.
- **Imperative mood.** `add X`, not `added X` or `adds X`. Body explains _why_; header states _what_.

## Testing

- **Lock in behaviour before you change it.** If a change touches untested code, write the test first to capture current behaviour, then make the change.
- **Every new feature and bug fix carries its test.** Happy path, one edge case, one error condition at minimum.
- **Run the suite after every non-trivial change.** A green suite is the only merge signal.

## TypeScript

- **Implicit typing wins** where the inference is obvious. Annotate public APIs, exported functions, and anywhere the inferred type would be confusing.
- **Never `as`, never `any`, never `unknown`.** Use type guards, generics, discriminated unions, or `never`. Framework-generated code and a few third-party gaps are the only exceptions — document them with one-line comments.
- **Imports at the top, exports at the bottom, both sorted.** Prefer `export const`, `export function`, `export class` over `export { ... }`. Prefer `export * from` over re-listing.
- **Named exports only.** Default exports resist renaming and break grep. Reserve them for framework-required defaults.
- **Avoid barrel files.** Direct imports keep the dependency graph legible and tree-shaking honest.
- **Export only what other modules use.** Private helpers stay private.

## React and TanStack Start

- **`app/`** holds route-scoped code — pages, layouts, and any local `components/`, `hooks/`, `actions/`, `utils/` used only by that route. Top-level `components/`, `hooks/`, `actions/`, `utils/` hold code shared across routes.
- **Navigation** uses TanStack Router — `useNavigate()` and `<Link>`. No `window.location`.
- **Images** go through the custom `Image` component from `@/components/ui/image`. Never bare `<img>`.
- **No hardcoded user-facing strings.** Always the translation hook. A stray English literal in JSX is a bug.
- **Storybook is part of the component.** New UI primitives in `components/ui/` ship with a story covering every variant, size, and key state.
- **Reach for `useMemo`, `useCallback`, `memo` only when the profile justifies it.** Don't reach for `useEffect` either — most needs are better served by derived state, event handlers, or the router.
- **CVA for named variants** (`variant`, `size`, `tone`); a conditional `cn()` for boolean states (`isActive`, `hasError`).

## Convex

- **No `.collect()`.** Iterate with `for await`. `collect` pulls the whole result set into memory and scales badly.
- **Backend returns raw data.** Filtering, sorting, and pagination happen on the client. Listing queries should not accept `limit`/`cursor` unless a page has unbounded rows.
- **Shared validation via Zod.** Schemas live in `services/platform/lib/shared/validators/`. Import on both client and server.
- **Preload where you can.** `preloadQuery` + `usePreloadedQuery` skip client-side loading flashes on route entry.
- **Delete deprecated functions.** No `@deprecated` tombstones — remove the function, update the callers.
- **Schema changes are effectively forward-only.** Additive (new optional fields, new tables) is safe to roll back; required fields, renames, and type changes need a two-release expand-contract migration.
- **Convex runs as its own service.** Function source lives at `services/platform/convex/`. Platform pushes schema and env vars on startup via `bunx convex env set` then `bunx convex deploy`. `api.d.ts` is committed; regenerate locally with `bunx convex codegen`.

## Python

- **snake_case** for files, functions, and variables.
- **Module layout:** `routers/`, `services/`, `models/`, `utils/` under each service's `app/`. Flat packages beat deep hierarchies.
- **Type hints on every signature.** Use `from __future__ import annotations` and prefer PEP 604 unions (`str | None`).
- **`uv` is the package manager.** `uv sync --extra dev` to set up; never edit `requirements*.txt` by hand.

## Databases and migrations

Postgres (`tale_knowledge`) is shared by RAG and crawler but **each service owns its own schema** — `private_knowledge` is RAG's, `public_web` is crawler's. Migrations live next to the service that owns them: `services/rag/migrations/`, `services/crawler/migrations/`. Both run via dbmate at each service's container startup.

- **Shared infrastructure only goes in `services/db/init-scripts/`**: database creation, extensions, schema namespaces, role grants. Never table DDL there.
- **Tracking tables are schema-scoped** (`private_knowledge.schema_migrations`, `public_web.schema_migrations`).
- **Timestamped filenames** (`YYYYMMDDhhmmss_description.sql`) with `-- migrate:up` and `-- migrate:down` sections.
- **Idempotent DDL** (`CREATE TABLE IF NOT EXISTS`, `DROP COLUMN IF EXISTS`, etc.).
- **Cross-service schema changes ship as two sibling migrations**, one per service — never fold them into a single centralized file.

## Internationalization

Every user-facing string goes through the translation layer. Never compare against an English literal in code, tests, stories, or comments — the UI ships localized labels and literal comparisons drift silently.

### Keys and files

- **`en.json` is the schema.** Every key in `en.json` exists in `de.json` and `fr.json` on the same commit. Variants (`de-AT`, `de-CH`, `fr-CH`) carry only the keys whose values differ — missing keys fall back to the base.
- **Add, change, and remove keys in every base locale on the same commit.** Variants only move when they override the changed key.
- **When code that referenced a key disappears, remove the key from every locale.** Dead keys rot in place — the orphan-key test in `services/platform/lib/i18n/messages-usage.test.ts` enforces this.
- **UI wins over terminology.** If a `TERMINOLOGY_<LOCALE>.md` file disagrees with the shipped label, update the terminology file to match the UI, then propagate the new form into any doc page that quotes it.

### Implementation

- **`useT(namespace)` hook** from `services/platform/lib/i18n/client.tsx`. Returns `{ t }`. Pass the namespace as the argument so `t('key')` resolves to `namespace.key` in the JSON.
- **`useFormatDate()`** from `services/platform/lib/utils/date/format` for any date formatting. Never call `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString`.
- **Files** at `services/platform/messages/`. Fallback chain: `de-CH → de → en`, `de-AT → de → en`, `fr-CH → fr → en`.

### Tone and formatting

- **Sentence case in every translation.**
- **Informal form across all languages** — `du` in German, `tu` in French. Never `Sie` or `vous`.
- **ICU placeholders are sacred.** `{count, plural, ...}`, `{field}`, `{error, select, ...}` copy exactly, including argument order.
- **Brand names don't translate.** Tale, Convex, Gmail, Shopify, OpenRouter, Claude, GitHub, Slack, Mintlify.

Read [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md) for cross-locale rules and the per-locale `TERMINOLOGY_<LOCALE>.md` files for forms.

## Documentation

Docs are not a follow-up task. Every change a user would notice updates the docs in every locale in the same PR. Full rules — taxonomy, writing depth, locale workflow, verification — live in [`docs/AGENTS.md`](docs/AGENTS.md) and are loaded automatically for agents working under `docs/`.

Before opening a PR that touches `docs/`:

```bash
bun run --filter @tale/docs format    # oxfmt: normalize Markdown and JSON
bun run --filter @tale/docs lint      # oxlint + Mintlify broken-link check
bun run --filter @tale/docs test      # frontmatter, locale parity, terminology, navigation parity
```

## Accessibility

Everything Tale ships meets [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/). The rules below are mandatory; they are not aspirational.

- **Real HTML elements.** `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`. `<div onClick>` is not a button.
- **One `<main>` per page**, one `<h1>`, never skip heading levels. Use `<header>`, `<nav aria-label="…">`, `<aside>`, `<footer>` to structure the rest. First focusable element is a skip link.
- **Every image has an `alt`** (decorative images use `alt=""`). Every icon-only button has a translated `aria-label` — never hardcode English in ARIA.
- **Everything interactive is keyboard-reachable.** Test with `Tab` and `Shift+Tab` before merging. Focus rings stay visible and meet 3:1 contrast. Focus traps only inside modal dialogs and return to the trigger on close. Minimum 24×24 CSS pixel touch target (44×44 on mobile).
- **Forms:** labels pair with inputs via `htmlFor` or wrapping. Errors tell the user what and how (`"Please enter a valid email address"`, not `"Invalid input"`). Wire errors via `aria-describedby`, `aria-invalid`, and `role="alert"` on the message.
- **Contrast:** text ≥4.5:1; large text (18pt+ or 14pt bold) ≥3:1; non-text UI ≥3:1. Colour never stands alone — pair with shape, text, or position.
- **Motion:** respect `prefers-reduced-motion: reduce` on every animation. Use the `motion-reduce:` Tailwind prefix for CSS overrides.
- **Tables:** `<caption>` (`sr-only` is fine), `scope="col"` on every `<th>`, `aria-selected` on selected rows.
- **Dynamic content:** `aria-live="polite"` for non-urgent updates; `assertive` only for truly critical alerts. Loading containers use `aria-busy`; spinners are `role="status"` with an `aria-label`.
- **Dialogs:** every dialog has a title (visible or `VisuallyHidden`); focus is trapped while open and returns to the trigger on close.
- **Verification:** every UI component has an `accessibility` describe block invoking `checkAccessibility()` from `@/test/utils/a11y`. Every Storybook story is audited automatically via `addon-a11y` against WCAG 2.1 AA. A red bar in Storybook is a blocker.
