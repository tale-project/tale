# Tale — coding standards

The contract for writing code in this repository. Read this file in full before your first change. Deeper rules for specific surfaces live in dedicated files and are linked from the relevant section.

## Orientation

Tale is a monorepo managed with Bun workspaces. Every script runs through the workspace filter:

```bash
bun run --filter @tale/<workspace> <script>
```

Workspaces: `@tale/platform`, `@tale/cli`, `@tale/crawler`, `@tale/rag`, `@tale/db`, `@tale/proxy`, `@tale/docs`.

Sibling guides you may need during a change:

- [`docs/AGENTS.md`](docs/AGENTS.md) — Mintlify documentation rules. Loaded automatically when editing `docs/`.
- [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md) — cross-locale translation rules. Per-locale terms live in `TERMINOLOGY_<LOCALE>.md`.

## Non-negotiable rules

These hold across every workspace and language. They are not style preferences.

- **Never destroy state without explicit permission.** Local databases, Convex state, caches, config files, branded seed data — ask before wiping. Assume every file on disk may be the user's in-progress work.
- **Never hardcode secrets or credentials.** Environment variables only. Scrub logs before committing.
- **Validate at every system boundary.** User input, external APIs, webhook payloads. Parameterized queries only; never string-concatenate SQL or shell.
- **Docs ship with the code.** If a change alters what a user sees, configures, or calls, the same PR updates `docs/` in all three locales (`en`, `de`, `fr`). No exceptions. See [`docs/AGENTS.md`](docs/AGENTS.md).
- **Translations stay in sync.** Every key in `en.json` exists in `de.json` and `fr.json` on the same commit. Variant files (`de-AT`, `de-CH`, `fr-CH`) only hold overrides.
- **Accessibility is Level AA, not a nice-to-have.** See [Accessibility](#accessibility) below.

## Code style

- **Filenames:** dash-case everywhere except Convex and Python, which use snake_case.
- **No status comments.** `// REFACTORED`, `// ✅ removed`, `// TODO: see #123` are noise. Write self-documenting code; put context in the commit message or PR.
- **No comments explaining what was removed.** Removed code is gone; git log is the record.
- **Comments explain _why_, rarely _what_.** If a well-named identifier already tells the reader what, you are writing redundant prose.
- **No empty catch blocks.** Log with `console.warn` / `console.error` or re-throw. Silent catches hide real bugs and have before.
- **No locale-aware date methods.** `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` are banned. Use `useFormatDate()` in React or `formatDate()` from `lib/utils/date/format`.
- **Imperative mood in commits.** `add X`, not `added X` or `adds X`.

## Security

Security is a first pass, not a clean-up step. During every change, check the OWASP top 10 apply: command injection, XSS, SQL injection, SSRF, auth bypass, IDOR, deserialization. If you introduce code that touches a boundary (request handler, file system, shell), assume adversarial input and prove it is safe.

## Git and commits

- **Scope and type:** see [`commitlint.config.mjs`](commitlint.config.mjs) for the allowed set.
- **Header ≤72 characters.** The header becomes the PR title; longer truncates on GitHub.
- **Lowercase description, no trailing period.** `feat(platform): add arena mode` — not `feat(Platform): Add Arena Mode.`.
- **Atomic commits.** One logical change per commit. If the message needs "and", it should probably be two commits.
- **Body for context, header for what.** Separate with a blank line. Use the body to explain _why_ a change was made and any non-obvious trade-offs.

## Testing

- **Lock in behaviour before you change it.** If a change touches untested code, write the test first to capture current behaviour, then make the change. The test protects against accidental regressions.
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

### Layout

- **`app/`** holds route-scoped code — pages, layouts, and any local `components/`, `hooks/`, `actions/`, `utils/` used only by that route.
- **Top-level `components/`, `hooks/`, `actions/`, `utils/`** hold code shared across routes.
- **Navigation** uses TanStack Router — `useNavigate()` and `<Link>`. No `window.location`.
- **Images** go through the custom `Image` component from `@/components/ui/image`. Never bare `<img>`.

### Components and state

- **Storybook is part of the component.** New UI primitives in `components/ui/` ship with a story covering every variant, size, and key state.
- **No hardcoded user-facing strings.** Always the translation hook. A stray English literal in JSX is a bug.
- **Reach for `useMemo`, `useCallback`, `memo` only when the profile justifies it.** Premature memoization adds indirection and bugs of its own.
- **Don't reach for `useEffect`.** Most needs are better served by derived state, event handlers, or the router.

### CVA

Use `cva` for named variants (`variant`, `size`, `tone`). Use a conditional `cn()` for boolean states (`isActive`, `hasError`).

```tsx
const buttonVariants = cva('base-button', {
  variants: {
    variant: {
      primary: 'bg-primary text-white',
      secondary: 'bg-secondary text-gray-900',
    },
    size: {
      sm: 'px-2 py-1 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
    },
  },
});

<button
  className={cn(
    buttonVariants({ variant, size }),
    isActive && 'ring-2 ring-blue-500',
    hasError && 'border-red-500',
  )}
/>;
```

## Convex

### Conventions

- **No `.collect()`.** Iterate with `for await`. `collect` pulls the whole result set into memory and scales badly.
- **Backend returns raw data.** Filtering, sorting, and pagination happen on the client. Listing queries should not accept `limit`/`cursor` unless a page has unbounded rows.
- **Shared validation via Zod.** Schemas live in [`lib/shared/validators/`](services/platform/lib/shared/validators/). Import on both client and server. Do not re-declare validation on one side.
- **Preload where you can.** `preloadQuery` + `usePreloadedQuery` skip client-side loading flashes on route entry.
- **Delete deprecated functions.** No `@deprecated` tombstones — remove the function, update the callers.
- **Fetch URLs are hardcoded.** Don't decide endpoints with `if/else`. Two hardcoded calls are cheaper than one conditional call.

```ts
// Good
const products = ctx.db.query('products');
for await (const product of products) {
  // process product
}

// Bad — loads everything into memory
const products = await ctx.db.query('products').collect();
```

### Deployment (split architecture)

The Convex backend is a standalone Docker service; function source lives at [`services/platform/convex/`](services/platform/convex/) and is copied into the Convex image at build time.

- **Platform pushes schema and env vars on startup.** `bunx convex env set` then `bunx convex deploy --url http://convex:3210`, both driven by [`services/platform/docker-entrypoint.sh`](services/platform/docker-entrypoint.sh).
- **Env vars persist in Convex's own DB.** Only pushed when code or env changes — Convex restarts do not reset them.
- **Code updates rebuild the platform image only.** Convex keeps serving WebSocket clients without a restart. That is by design.
- **`api.d.ts` is committed.** Regenerate locally with `bunx convex codegen` against a running backend and commit the result.
- **Local dev, two modes.** Either `docker compose up convex` + `CONVEX_EXTERNAL=true bun run dev` (Vite proxies to the containerised backend), or plain `bun run dev` (spawns `bunx convex dev`).
- **Schema changes are effectively forward-only.** Additive changes (new optional fields, new tables) are safe to roll back; required fields, renames, and type changes need a two-release expand-contract migration.

## Python

- **snake_case** for files, functions, and variables.
- **Module layout:** `routes/`, `services/`, `models/`, `utils/` under each service. Flat packages beat deep hierarchies.
- **Type hints on every signature.** Use `from __future__ import annotations` and prefer PEP 604 unions (`str | None`).

## Internationalization

Every user-facing string goes through the translation layer. Never compare against an English literal in code, tests, stories, or comments — the UI can (and does) ship localized labels, and literal comparisons drift silently.

### Keys and files

- **`en.json` is the schema.** Every base locale (`de.json`, `fr.json`) carries the same key set. Variants (`de-AT.json`, `de-CH.json`, `fr-CH.json`) carry only the keys whose values differ — missing keys fall back to the base.
- **Add, change, and remove keys in every base locale on the same commit.** Variants only move when they override the changed key.
- **When code that referenced a key disappears, remove the key from every locale.** Dead keys rot in place.
- **UI wins over terminology.** If `TERMINOLOGY_<LOCALE>.md` disagrees with the shipped label, update the terminology file to match the UI, then propagate the new form into any doc page that quotes it.

### Tone and formatting

- **Sentence case in every translation.**
- **Informal form across all languages** — `du` in German, `tu` in French. Never `Sie` or `vous`.
- **ICU placeholders are sacred.** `{count, plural, ...}`, `{field}`, `{error, select, ...}` copy exactly, including argument order.
- **Brand names don't translate.** Tale, Convex, Gmail, Shopify, OpenRouter, Claude, etc.

### Terminology references

Read both files before editing translations:

- [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md) — cross-locale rules (length parity, tone, plurals, placeholders).
- [`.agents/TERMINOLOGY_EN.md`](.agents/TERMINOLOGY_EN.md) — English source terms.
- [`.agents/TERMINOLOGY_DE.md`](.agents/TERMINOLOGY_DE.md) — German base. Variants: [`DE_AT`](.agents/TERMINOLOGY_DE_AT.md), [`DE_CH`](.agents/TERMINOLOGY_DE_CH.md).
- [`.agents/TERMINOLOGY_FR.md`](.agents/TERMINOLOGY_FR.md) — French base. Variant: [`FR_CH`](.agents/TERMINOLOGY_FR_CH.md).

The same rules govern docs prose — see [`docs/AGENTS.md`](docs/AGENTS.md) for how they map onto the Mintlify site.

## Documentation

Docs are not a follow-up task. Every change that a user would notice updates the docs in every locale in the same PR. The full rules (taxonomy, writing depth, locale workflow, verification) live in [`docs/AGENTS.md`](docs/AGENTS.md) and are loaded automatically for agents working under `docs/`.

Before opening a PR that touches `docs/`, all three of these must pass:

```bash
bun run --filter @tale/docs format         # oxfmt: normalize Markdown and JSON
bun run --filter @tale/docs lint            # frontmatter + terminology + Mintlify broken-link check
```

## Accessibility

Everything Tale ships meets [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/). The rules below are mandatory; they are not aspirational.

### Semantics and landmarks

- **Real HTML elements.** `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`. `<div onClick>` is not a button.
- **One `<main>` per page.** Use `<header>`, `<nav aria-label="...">`, `<aside>`, `<footer>` to structure the rest.
- **Skip link as the first focusable element** in the root layout, using `sr-only focus:not-sr-only`:

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
>
  {t('aria.skipToContent')}
</a>
```

### Text alternatives

- **Every image has an `alt`.** Decorative images use `alt=""`. Complex images reference a longer description via `aria-describedby`.
- **Every icon-only button has an `aria-label`.** The label goes through the translation layer — never hardcode English in ARIA.

### Keyboard and focus

- **Everything interactive is keyboard-reachable.** Test with `Tab` and `Shift+Tab` before merging.
- **Focus rings stay visible and meet 3:1 contrast.**
- **Focus traps only inside modal dialogs.** Focus returns to the trigger on close.
- **Minimum 24×24 CSS pixel touch target** (WCAG 2.5.8). Prefer 44×44 on mobile.

### Structure

- **One `<h1>` per page.** Never skip heading levels.

### Forms

- **Labels pair with inputs** via `htmlFor` or wrapping.
- **Errors tell the user what and how.** `"Please enter a valid email address"`, not `"Invalid input"`.
- **Wire errors to inputs** via `aria-describedby`, `aria-invalid`, and `role="alert"` on the message.

```tsx
<div>
  <label htmlFor="email">{t('signup.email.label')}</label>
  <input
    id="email"
    type="email"
    aria-describedby="email-error"
    aria-invalid={hasError}
  />
  {hasError && (
    <span id="email-error" role="alert">
      {t('signup.email.error')}
    </span>
  )}
</div>
```

### Colour and contrast

- **Text ≥4.5:1** against its background. Large text (18pt+, or 14pt bold) ≥3:1.
- **Non-text UI and graphics ≥3:1** against adjacent colours.
- **Colour never stands alone.** Pair with shape, text, or position.

### Motion

- **Respect `prefers-reduced-motion: reduce`** on every animation and transition. Use the `motion-reduce:` Tailwind prefix for CSS-driven overrides.

### Tables

- **Data tables carry a `<caption>`** (visually hidden with `sr-only` is fine).
- **`scope="col"` on every `<th>`.**
- **Selected rows get `aria-selected`:**

```tsx
<TableRow aria-selected={row.getIsSelected() || undefined}>{/* … */}</TableRow>
```

### Dynamic content

- **`aria-live="polite"`** for non-urgent updates (toasts, status).
- **`aria-live="assertive"`** only for truly critical alerts.
- **`aria-atomic="true"`** when the whole region should be re-read.
- **Loading containers** use `aria-busy`; spinners are `role="status"` with an `aria-label`:

```tsx
<div aria-busy={isLoading}>
  {isLoading ? <Spinner label={t('common.loading')} /> : <Content />}
</div>
```

### Dialogs

- **Every dialog has a title** (visible or wrapped in `VisuallyHidden`).
- **Focus is trapped while open** and returns to the trigger on close.

### Verification

- **Every UI component has an `accessibility` describe block** in its test file, invoking `checkAccessibility()` from `@/test/utils/a11y`.
- **Every Storybook story** is audited automatically via the `addon-a11y` plugin against the WCAG 2.1 AA ruleset. A red bar in Storybook is a blocker.
