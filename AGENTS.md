# Tale Coding Standards

## General

- USE Bun workspaces for running scripts: `bun run --filter @tale/<workspace> <script>` (e.g., `bun run --filter @tale/platform lint`).
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

- KEEP all translation files in sync — every key in `en.json` MUST exist in all locale files (`de.json`, etc.).
- WHEN adding, changing, or removing a translation key, update ALL locale files in the same commit.
- WHEN removing code that references translation keys, also remove the unused keys from ALL locale files.
- USE sentence case in all translations.
- PRESERVE ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`).
- DO NOT translate brand names (Tale, Gmail, Outlook, Shopify, etc.).
- USE informal form (e.g. "du" not "Sie"). This applies to all languages (e.g., "tu" in French, not "vous").

### German (de) terminology

| English                        | German                           | Notes                  |
| ------------------------------ | -------------------------------- | ---------------------- |
| AI                             | KI                               | Künstliche Intelligenz |
| Agent                          | Agent                            | Established tech term  |
| Workflow / Dashboard / Webhook | Keep English                     | Established loanwords  |
| API / LLM / Token / Prompt     | Keep English                     | Universal tech terms   |
| Provider                       | Anbieter                         |                        |
| Settings                       | Einstellungen                    |                        |
| Knowledge                      | Wissen                           |                        |
| Automation(s)                  | Automatisierung(en)              |                        |
| Team / Branding                | Keep English                     | Loanwords              |
| Integration(s)                 | Integration(en)                  | Same in German         |
| Save / Delete / Edit           | Speichern / Löschen / Bearbeiten |                        |
| Log in                         | Anmelden                         |                        |

- KEEP translations roughly the same length as English — use shorter synonyms or abbreviations when German is notably longer.
- USE standard German compounding for compound nouns (e.g., "API-Schlüssel", "E-Mail-Anbieter").
- USE ICU `one`/`other` for German plurals (same structure as English).

## Python

- USE snake_case for files, functions, and variables.
- ORGANIZE code into modules: `routes/`, `services/`, `models/`, `utils/` as needed.
- PREFER type hints for function signatures.

## Documentation

- Documentation lives in `docs/` and uses Mintlify (`docs/docs.json` controls navigation).
- ALWAYS add Mintlify frontmatter (`title` and `description`) to every doc file.
- USE dash-case for documentation filenames (e.g., `api-reference.md`).
- KEEP each doc file focused on a single topic. Do not combine unrelated topics in one file.
- WHEN adding a new doc page, also add it to the appropriate navigation group in `docs/docs.json`.
- WHEN renaming or removing a doc page, update all references in `README.md` and `docs/docs.json`.
- ALWAYS keep documentation up-to-date when making code changes that affect user-facing behavior, APIs, configuration, or setup steps.
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
  {isLoading ? (
    <Spinner label={t('common.loading')} />
  ) : (
    <Content />
  )}
</div>
```
