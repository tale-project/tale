# Smoke

> **Prefix** `SMOKE-` · **Reset** none · **Cost** ~10 min

The fast "is this build even drivable" pass over ui.tale.dev. Green ⇒ go on to
the suites that matter for what changed; red ⇒ stop and fix, because everything
after this reads on top of it.

The root and `/docs/*` pages share the app-language documentation frame
(`@tale/ui`). The boxes here prove its shell; the following suites judge it.

## Preconditions

The dev server up per [`../setup.md`](../setup.md), devtools open, a 1440×900
viewport, the theme at **System** with the OS in light mode.

> **Agent note**: wait on the route's heading. The root guide's `h1` is
> **Introduction**; other guides use their frontmatter `title` (Button, Input, …).

## Boxes

- [ ] `SMOKE-1` · **Open `/` with the console open** → Introduction renders in the shared docs frame with its selected rail row, header and article; no console message at `warn` or `error` level.
- [ ] `SMOKE-2` · **Open `/docs/components/button`** → the app chrome renders:
  the rail with the Button row highlighted, the header strip with the trail
  **Docs / Components / Button**, the article, the **On this page** outline; no
  console message at `warn` or `error` level.
- [ ] `SMOKE-3` · **Reload the docs page** → it re-renders from the URL alone
  with the same chrome; no flash of an empty shell, no error boundary, no
  hydration warning in the console.
- [ ] `SMOKE-4` · **Scroll the Button page to the end** → every section the
  outline lists is in the article (Variants … Accessibility and alternatives), and every
  **Live example** shows real controls, not an **Unknown demo** box.
- [ ] `SMOKE-5` · **Reach the first Live example's Code button with Tab alone
  and activate it with Enter, then with Space** → focus is visible at every stop,
  the source panel opens (`aria-expanded` flips) and closes again.
- [ ] `SMOKE-6` · **Open `/docs/nope-not-a-page`** → the not-found page
  renders inside the docs frame (**Page not found**, a **Back to docs home**
  button); no white screen, no unhandled rejection in the console.
