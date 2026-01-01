## General

- ALWAYS optimize your code for MAX performance.
- ALWAYS ensure that you follow the existing design.
- ALL pages should be optimized for accessibility (Level AA).
- ALWAYS write filenames in dash-case (generally) and snake_case (for Convex and Python).

## TypeScript

- USE implicit typing whenever possible.
- DO NOT use type casting. Avoid `any`, and `unknown` whenever possible.
- ALWAYS put imports at the top and exports at the bottom. Keep them sorted correctly.
- PREFER named exports.

## React

- Do NOT hardcode text, use the translation hooks/functions instead for user-facing UI.
- CONSIDER ALWAYS TO add optimistic updates with `withOptimisticUpdate` for `useMutation`. If you decide to NOT add a optimistic update you need to provide a good reason why and comment the hook.
- CONSIDER ALWAYS TO use reusable components.
- USE `useMemo`, `useCallback` and `memo` the right moment.
- DO NOT overuse `useEffect`.
- USE `cva` if a component has multiple variants.

## Convex

- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React.
- CONSIDER TO use rate limiting and action caching.
