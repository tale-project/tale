## General

- ALWAYS optimize your code for MAX performance.
- ALWAYS ensure that you follow the existing design.
- ALL pages should be optimized for accessibility (Level AA).
- ALWAYS write filenames in dash-case (generally) and snake_case (for Convex and Python).

## TypeScript

- USE implicit typing whenever possible.
- DO NOT use type casting. Avoid `any`, and `unknown` whenever possible.
- ALWAYS put imports at the top and exports at the bottom. Keep them sorted correctly.
- PREFER named exports. AVOID default exports (only if needed).
- AVOID index barrel files (only if it makes sense to group).

## React / Next.js

- Do NOT hardcode text, use the translation hooks/functions instead for user-facing UI.
- CONSIDER ALWAYS TO add optimistic updates with `withOptimisticUpdate` for `useMutation`. If you decide to NOT add a optimistic update you need to provide a good reason why and comment the hook.
- CONSIDER ALWAYS TO use reusable components.
- USE `useMemo`, `useCallback` and `memo` the right moment.
- DO NOT overuse `useEffect`.
- USE `cva` if a component has multiple variants.
- AVOID `router.refresh()`.
- **`/app`**: Route-specific code (pages, layouts, and subfolders like `components/`, `hooks/`, `actions/`, `utils/` scoped to that route).
- **`/components`, `/hooks`, `/actions`, `/utils`** (root): Shared/reusable code across multiple routes.
- AVOID CSR-only approaches, AVOID ssr: false, ALWAYS optimize for SSR.

## Convex

- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React.
- CONSIDER TO use rate limiting and action caching.
- DO NOT use `.collect()`, use `for await (const ... of ...)` instead.

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
