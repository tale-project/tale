---
type: 'always_apply'
---

# React guidelines

## Optimizations

- Debounce search queries with useDebounce from ahooks
- Use useMemo, useCallback, useEffect only where it makes sense, do NOT overuse it
- Keep backend calls as close as possible to where they are rendered.
- Use Suspense boundaries to cache components effectively
- Do not use router.refresh(), Convex should already handle everything correctly.
