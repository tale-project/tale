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

- Write clear, descriptive commit messages.
- Use conventional commit format when appropriate.
- Keep commits focused and atomic.

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

<button className={cn(
  buttonVariants({ variant, size }),
  isActive && 'ring-2 ring-blue-500',
  error && 'border-red-500'
)} />
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
const products = ctx.db.query("products");
for await (const product of products) {
  // process product
}

// Bad: don't use .collect()
// const products = await ctx.db.query("products").collect();
```

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

- ALWAYS CONSIDER semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`).
- ALWAYS provide text alternatives for non-text content (`alt` for images, `aria-label` for icon buttons).
- ENSURE all interactive elements are keyboard accessible and have visible focus states.
- USE proper heading hierarchy (`h1` → `h2` → `h3`), never skip heading levels.
- ALWAYS associate form labels with inputs using `htmlFor` or wrapping.
- PROVIDE clear error messages that identify the field and describe how to fix the issue.
- AVOID using color alone to convey information.
- USE `aria-live` regions for dynamic content updates.

### Accessible form example

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
