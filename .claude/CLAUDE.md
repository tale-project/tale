## Git

- DO NOT include "Co-Authored-By" in commit messages.

## General

- USE turbo for running scripts: `turbo run <script> --filter=<workspace>` (e.g., `turbo run lint --filter=platform`).
- ALWAYS optimize your code for MAX performance.
- ALWAYS ensure that you follow the existing design.
- ALL pages should be optimized for accessibility (Level AA).
- ALWAYS write filenames in dash-case (generally) and snake_case (for Convex and Python).
- ALWAYS use sentence case in translations.
- NEVER delete, remove, or clear databases, caches, state files, or any persistent data without EXPLICIT user permission. This includes local development databases (e.g., SQLite files, Convex local backend state), cache directories, and configuration state. Always ask first before any destructive action.
- DO NOT write status comments like "REFACTORED:", "UPDATED:", "CHANGED:", "✅ REMOVED:", etc. Write clean, self-documenting code with clear function/variable names instead.
- DO NOT write inline comments explaining what was removed or changed.

## TypeScript

- USE implicit typing whenever possible.
- DO NOT use type casting. Avoid `any`, and `unknown` whenever possible.
- ALWAYS put imports at the top and exports at the bottom. Keep them sorted correctly.
- PREFER named exports. AVOID default exports (only if needed).
- AVOID index barrel files as much as possible.
- PREFER `export const/let`, `export function`, `export class` etc. instead of `export { ... }`.
- PREFER `export * from` instead of `export { ... } from`.
- DO NOT export if not needed outside the module.

## React / TanStack Start

- ALWAYS add Storybook stories for new UI components in `components/ui/`. Stories should demonstrate all variants, sizes, and key states.
- Do NOT hardcode text, use the translation hooks/functions instead for user-facing UI.
- CONSIDER ALWAYS TO add optimistic updates with `withOptimisticUpdate` for `useMutation`. If you decide to NOT add a optimistic update you need to provide a good reason why and comment the hook.
- CONSIDER ALWAYS TO use reusable components.
- USE `useMemo`, `useCallback` and `memo` the right moment.
- DO NOT overuse `useEffect`.
- ALWAYS USE `cva` for named variants (e.g., `size: 'sm' | 'md' | 'lg'`, `variant: 'primary' | 'secondary'`). But DO NOT use `cva` for boolean states (e.g., `isActive`, `error`, `muted`). For boolean conditions, use conditional `cn()` patterns instead (e.g., `cn('base-classes', isActive && 'active-classes')`).
- **`/app`**: Route-specific code (pages, layouts, and subfolders like `components/`, `hooks/`, `actions/`, `utils/` scoped to that route).
- **`/components`, `/hooks`, `/actions`, `/utils`** (root): Shared/reusable code across multiple routes.
- USE TanStack Router for navigation with `useNavigate()` and `Link` components.
- USE the custom `Image` component from `@/components/ui/image` for all images.

## Convex

- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React.
- CONSIDER TO use rate limiting and action caching.
- DO NOT use `.collect()`, use `const query = ...; for await (const ... of query)` instead.
- ALWAYS share validation schemas between client and server using Zod. Validators are organized per domain in `lib/shared/validators/` (e.g., `members.ts`, `products.ts`). Import from `lib/shared/validators` on both client and server. DO NOT duplicate validation logic.
- Backend functions should return raw data only. All filtering, sorting, pagination happens on the client.
- DO NOT keep deprecated functions. Remove them entirely instead of marking with `@deprecated`.
- AVOID conditional endpoint determination. Use separate hardcoded fetch calls instead of if/else to determine endpoints dynamically.

## Python

- USE snake_case for files, functions, and variables.
- ORGANIZE code into modules: `routes/`, `services/`, `models/`, `utils/` as needed.
- PREFER type hints for function signatures.

## Accessibility (WCAG 2.1 Level AA)

- ALWAYS CONSIDER semantic HTML elements (`<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`).
- ALWAYS provide text alternatives for non-text content (`alt` for images, `aria-label` for icon buttons).
- ENSURE all interactive elements are keyboard accessible and have visible focus states.
- USE proper heading hierarchy (`h1` → `h2` → `h3`), never skip heading levels.
- ALWAYS associate form labels with inputs using `htmlFor` or wrapping.
- PROVIDE clear error messages that identify the field and describe how to fix the issue.
- AVOID using color alone to convey information.
- USE `aria-live` regions for dynamic content updates.
