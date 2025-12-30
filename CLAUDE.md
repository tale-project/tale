## General

- ALWAYS optimize your code for MAX performance.
- ALWAYS ensure that you follow the existing design.
- ALL pages should be optimized for accessibility (Level AA).
- ALWAYS write filenames in dash-case.

## React

- Do NOT hardcode text, use the translation hooks/functions instead for user-facing UI.
- CONSIDER ALWAYS TO add optimistic updates with `withOptimisticUpdate` for `useMutation`. If you decide to NOT add a optimistic update you need to provide a good reason why and comment the hook.
- CONSIDER ALWAYS TO use reusable components.
- USE `useMemo`, `useCallback` and `memo` the right moment.
- DO NOT overuse `useEffect`.
- USE `cva` if a component has multiple variants.

## Convex

- CONSIDER TO preload queries with `preloadQuery` and `usePreloadedQuery` in React.
