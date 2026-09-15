# Error-surface provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect the error state", and as the checklist for
"should this even be reachable from here?".

The site is static and has no backend of its own, so it carries no error
**codes**. Its error surfaces are the few rendered states below.

## Reachable from the UI

| Surface | How to reach it |
|---|---|
| **Page not found** (`docs.notFound.title`) | open any `/docs/<unknown>` or any path outside `/` and `/docs` — the `$` catch-all route renders it; on the built server it also carries a real `404` status ([seo.md](../suites/seo.md) `SEO-8`) |
| **Unknown demo** (`demo.missingTitle`, a `role="alert"` box in the article) | in dev only: reference a demo that has no file, e.g. `<Demo name="button/nope" />` in a scratch page — `tests/content.test.ts` refuses to let it ship |
| the search palette's error line | in dev, start the Vite server without the content build so `/search-index.json` is missing (`bun --bun vite` instead of `bun run dev`), open ⌘K and type — the palette reports the failed fetch instead of hanging |

## Reachable on the API surface only

Never a rendered message — seeing one of these in the UI is itself a bug.

| Failure | Where it shows up |
|---|---|
| `404` on `/docs/<slug>.md` for a slug that has no page | `curl -si /docs/nope.md` — the artifact server has no body for it |
| a non-`200` on `GET /api/health` | only while the Bun server is starting or shutting down; the container healthcheck polls it |

## Must never appear

An unhandled rejection, a React error boundary, a raw stack trace rendered in
the article, a live example rendering nothing (neither controls nor the
**Unknown demo** box), or any `error`-level console line not on the
known-benign list in [`not-a-finding.md`](not-a-finding.md). There is no repro
by definition; any sighting is a finding.

## Unreachable from the UI, still enforced

| Code | Guarded by | Proven by |
|---|---|---|
| a page whose body opens with a second `h1` | `tests/content.test.ts` (build gate) | the gate, not a box |
| a nav entry without a file, or a file outside the nav | `tests/navigation.test.ts` | the gate, not a box |
