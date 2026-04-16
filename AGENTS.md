# Tale Coding Standards

## General

- USE Bun workspaces for running scripts: `bun run --filter @tale/<workspace> <script>` (e.g., `bun run --filter @tale/platform lint`). Available workspaces: `@tale/platform`, `@tale/cli`, `@tale/crawler`, `@tale/rag`, `@tale/db`, `@tale/proxy`.
- ALWAYS optimize your code for MAX performance.
- ALWAYS ensure that you follow the existing design.
- ALL pages should be optimized for accessibility (Level AA).
- ALWAYS write filenames in dash-case (generally) and snake_case (for Convex and Python).
- ALWAYS use sentence case in translations.
- NEVER delete, remove, or clear databases, caches, state files, or any persistent data without EXPLICIT user permission. This includes local development databases (e.g., SQLite files, Convex local backend state), cache directories, and configuration state. Always ask first before any destructive action.
- DO NOT write status comments like "REFACTORED:", "UPDATED:", "CHANGED:", "✅ REMOVED:", etc. Write clean, self-documenting code with clear function/variable names instead.
- DO NOT write inline comments explaining what was removed or changed.
- DO NOT use `toLocaleDateString()`, `toLocaleTimeString()`, or `toLocaleString()`. Use `useFormatDate()` hook (React) or `formatDate()` from `lib/utils/date/format` instead.

## Security

- ALWAYS keep security in mind when writing code.
- Be careful not to introduce vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities.
- DO NOT hardcode secrets, API keys, or credentials. Use environment variables instead.
- Validate and sanitize all user input at system boundaries.
- Use parameterized queries for database operations.

## Git

- Refer to `commitlint.config.mjs` for allowed types and scopes.
- KEEP the first line (header) under 72 characters so it fits as a PR title without truncation.
- USE lowercase for the description after the colon. Do not end with a period.
- USE imperative mood in the description (e.g., "add feature" not "added feature").
- Keep commits focused and atomic.
- Use the body for additional context when needed (separate from header with a blank line).

## Testing

- BEFORE modifying existing code, ensure that adequate tests exist. If tests are missing, write them first to lock in current behavior, then make the change.
- ALWAYS write tests for new features and bug fixes.
- Tests should cover happy paths, edge cases, and error conditions.
- Run tests after changes to confirm nothing is broken.

## TypeScript

- USE implicit typing whenever possible.
- DO NOT use type casting (`as`). Use type guards, generics, or proper type narrowing instead. The only exception is framework-generated code or unavoidable third-party library limitations (document with a comment explaining why).
- DO NOT use `any` or `unknown` unless absolutely unavoidable. Prefer proper types, generics, or `never`.
- ALWAYS put imports at the top and exports at the bottom. Keep them sorted correctly.
- PREFER named exports. AVOID default exports (only if needed).
- AVOID index barrel files as much as possible.
- PREFER `export const/let`, `export function`, `export class` etc. instead of `export { ... }`.
- PREFER `export * from` instead of `export { ... } from`.
- DO NOT export if not needed outside the module.

## React / TanStack Start

- ALWAYS add Storybook stories for new UI components in `components/ui/`. Stories should demonstrate all variants, sizes, and key states.
- Do NOT hardcode text, use the translation hooks/functions instead for user-facing UI.
- CONSIDER ALWAYS TO use reusable components and standardized styles.
- USE `useMemo`, `useCallback` and `memo` the right moment.
- DO NOT overuse `useEffect`.
- ALWAYS USE `cva` for named variants (e.g., `size: 'sm' | 'md' | 'lg'`, `variant: 'primary' | 'secondary'`). But DO NOT use `cva` for boolean states (e.g., `isActive`, `error`, `muted`). For boolean conditions, use conditional `cn()` patterns instead (e.g., `cn('base-classes', isActive && 'active-classes')`).
- **`/app`**: Route-specific code (pages, layouts, and subfolders like `components/`, `hooks/`, `actions/`, `utils/` scoped to that route).
- **`/components`, `/hooks`, `/actions`, `/utils`** (root): Shared/reusable code across multiple routes.
- USE TanStack Router for navigation with `useNavigate()` and `Link` components.
- USE the custom `Image` component from `@/components/ui/image` for all images.

### CVA usage

```tsx
// Good: cva for named variants, cn() for booleans
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
    error && 'border-red-500',
  )}
/>;
```

## Convex

- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React.
- CONSIDER TO use rate limiting and action caching.
- DO NOT use `.collect()`, use `const query = ...; for await (const ... of query)` instead.
- ALWAYS share validation schemas between client and server using Zod. Validators are organized per domain in `lib/shared/validators/` (e.g., `members.ts`, `products.ts`). Import from `lib/shared/validators` on both client and server. DO NOT duplicate validation logic.
- Backend functions should return raw data only. All filtering, sorting, pagination happens on the client.
- DO NOT keep deprecated functions. Remove them entirely instead of marking with `@deprecated`.
- AVOID conditional endpoint determination. Use separate hardcoded fetch calls instead of if/else to determine endpoints dynamically.

### Split architecture (Phase 2+)

- Convex runs as its own Docker service (`services/convex/`). Function source still lives at `services/platform/convex/`; the convex image COPY-es it in at build time.
- Platform pushes schema + env vars at its startup: `bunx convex env set` then `bunx convex deploy --url http://convex:3210`. This happens in `services/platform/docker-entrypoint.sh`.
- Convex env vars are PERSISTENT (stored in Convex's own DB), so pushes only need to happen on code/env changes, not on every convex restart.
- Code updates rebuild the platform image ONLY. The convex container does not restart for function changes — WebSocket clients stay connected.
- `api.d.ts` is committed to git. Regenerate locally with `bunx convex codegen` against a running backend; commit the result.
- Local development: `docker compose up convex` then `CONVEX_EXTERNAL=true bun run dev` (Vite proxies to the containerised convex), OR run everything inside the local `bunx convex dev` spawn (default `bun run dev` behaviour — still works).
- Schema changes: additive (new optional fields, new tables) are safe for rollback. Breaking changes (new required fields, renames, type changes) are effectively forward-only — document a two-release expand-contract migration for them.

### Query iteration

```typescript
// Good: async iteration
const products = ctx.db.query('products');
for await (const product of products) {
  // process product
}

// Bad: don't use .collect()
// const products = await ctx.db.query("products").collect();
```

## Internationalization (i18n)

- KEEP all translation files in sync — every key in `en.json` MUST exist in all base locale files (e.g. `de.json`, `fr.json`). Locale variants (e.g. `de-AT.json`, `de-CH.json`, `fr-CH.json`) only override keys that differ.
- WHEN adding, changing, or removing a translation key, update `en.json` and all base locale files (e.g. `de.json`, `fr.json`) in the same commit. Update variants (e.g. `de-AT.json`, `de-CH.json`, `fr-CH.json`) only if they override the changed key.
- WHEN removing code that references translation keys, also remove the unused keys from ALL locale files.
- LOCALE VARIANTS (e.g. `de-CH`, `de-AT`) only contain keys whose values differ from the base locale (e.g. `de`). Variants fall back to its base automatically.
- USE sentence case in all translations.
- PRESERVE ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`).
- DO NOT translate brand names (Tale, Gmail, Outlook, Shopify, etc.).
- USE informal form (e.g. "du" not "Sie"). This applies to all languages (e.g., "tu" in French, not "vous").

### Language-specific terminology

Terminology tables and style rules for each locale live in `.agents/`. Read these before adding or modifying translations:

- **English (en):** [`.agents/TERMINOLOGY_EN.md`](.agents/TERMINOLOGY_EN.md)
- **German (de):** [`.agents/TERMINOLOGY_DE.md`](.agents/TERMINOLOGY_DE.md)
- **French (fr):** [`.agents/TERMINOLOGY_FR.md`](.agents/TERMINOLOGY_FR.md)

## Python

- USE snake_case for files, functions, and variables.
- ORGANIZE code into modules: `routes/`, `services/`, `models/`, `utils/` as needed.
- PREFER type hints for function signatures.

## Documentation

- Documentation lives in `docs/` and uses Mintlify (`docs/docs.json` controls navigation).
- TREAT documentation as part of the deliverable, not an afterthought. Any change that affects what users see, configure, or interact with MUST include a corresponding documentation update in the same PR. This includes new features, changed behavior, renamed settings, new environment variables, updated APIs, and removed functionality. Work without up-to-date docs is not complete.
- WHEN adding a new doc page, also add it to the appropriate navigation group in `docs/docs.json`.
- WHEN renaming or removing a doc page, update all references in `README.md` and `docs/docs.json`.
- ALWAYS add Mintlify frontmatter (`title` and `description`) to every doc file.
- USE dash-case for documentation filenames (e.g., `api-reference.md`).
- KEEP each doc file focused on a single topic. Do not combine unrelated topics in one file.
- PREFER cross-linking between doc pages over duplicating content.
- USE code blocks with language identifiers for all command examples.
- USE Mermaid diagrams for flow charts and architecture diagrams in documentation.
- USE sentence case for headings.
- FORMAT tables with aligned columns and consistent spacing for readability in editors.

## Accessibility (WCAG 2.1 Level AA)

All UI must conform to [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/). The rules below apply to every component, page, and feature.

### Semantic HTML and landmarks

- USE semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`).
- ENSURE every page has exactly one `<main>` element. Use `<header>`, `<nav aria-label="...">`, `<aside>`, `<footer>` as appropriate.
- INCLUDE a skip-to-main-content link as the first focusable element in the root layout. Use the `sr-only focus:not-sr-only` pattern.

### Text alternatives and ARIA

- ALWAYS provide text alternatives for non-text content (`alt` for images, `aria-label` for icon buttons).
- ENSURE decorative images use `alt=""`. Complex images use `aria-describedby` pointing to a longer description.
- ALWAYS use translation keys for `aria-label` values. Never hardcode English in ARIA attributes.

### Keyboard and focus

- ENSURE all interactive elements are keyboard accessible and have visible focus states.
- ENSURE focus rings have at least 3:1 contrast against adjacent colors.
- NEVER trap focus except in modal dialogs. Focus MUST return to the trigger element when a dialog closes.
- ENSURE interactive elements have a minimum 24×24 CSS pixel touch target (WCAG 2.5.8). Prefer 44×44 for mobile.

### Headings and structure

- USE proper heading hierarchy (`h1` → `h2` → `h3`), never skip heading levels.
- ENSURE each page has exactly one `h1`.

### Forms

- ALWAYS associate form labels with inputs using `htmlFor` or wrapping.
- PROVIDE clear error messages that identify the field and describe how to fix the issue.
- USE `aria-describedby` to link inputs to their descriptions and error messages.
- USE `aria-invalid` on inputs with validation errors and `role="alert"` on error messages.

### Color and contrast

- ENSURE all text meets 4.5:1 contrast ratio against its background. Large text (18pt+ or 14pt bold) must meet 3:1.
- ENSURE non-text UI components and graphical objects meet 3:1 contrast.
- AVOID using color alone to convey information.

### Motion and animation

- ENSURE all animations and transitions respect `prefers-reduced-motion: reduce`.
- USE the `motion-reduce:` Tailwind prefix for CSS-driven animation overrides.

### Tables

- ENSURE data tables have a `<caption>` (can be visually hidden with `sr-only`).
- USE `scope="col"` on `<th>` elements.
- ENSURE selected rows have `aria-selected="true"`.

### Live regions and dynamic content

- USE `aria-live="polite"` for non-urgent updates (toast notifications, status changes).
- USE `aria-live="assertive"` only for critical alerts.
- USE `aria-atomic="true"` when the entire region should be re-read.

### Dialogs and overlays

- ENSURE all dialogs have a title (visible or wrapped in `VisuallyHidden`).
- ENSURE focus is trapped inside open dialogs and returns to the trigger on close.

### Loading states

- USE `aria-busy="true"` on containers whose content is loading.
- USE `role="status"` with `aria-label` for spinners.

### Testing

- EVERY UI component MUST have an `accessibility` describe block in its test file using `checkAccessibility()` from `@/test/utils/a11y`.
- EVERY Storybook story is automatically audited via the `addon-a11y` plugin (WCAG 2.1 AA ruleset).

### Examples

#### Skip link

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
>
  {t('aria.skipToContent')}
</a>
```

#### Accessible form

```tsx
<div>
  <label htmlFor="email">Email Address</label>
  <input
    id="email"
    type="email"
    aria-describedby="email-error"
    aria-invalid={hasError}
  />
  {hasError && (
    <span id="email-error" role="alert">
      Please enter a valid email address
    </span>
  )}
</div>
```

#### Table row selection

```tsx
<TableRow aria-selected={row.getIsSelected() || undefined}>
  {/* row cells */}
</TableRow>
```

#### Loading state

```tsx
<div aria-busy={isLoading}>
  {isLoading ? <Spinner label={t('common.loading')} /> : <Content />}
</div>
```
