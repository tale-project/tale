# Content rendering — Manual Test Plan

> **Purpose**: Exercise how a docs page renders and what a reader can do with
> it — syntax-highlighted code blocks with copy buttons, heading deep links
> (anchor + copy-link), the page-actions cluster (**Copy page**, **Open in**,
> the `.md` view), **Edit on GitHub**, reading-time/last-updated metadata, and
> images. Source-level integrity (every link resolves, every fence has a
> language, headings well-formed) is already automated by the vitest content
> suite — this guide covers the **rendered** behaviour it can't see.

## Scope & routes

Any content page works; the rows use
`{base}/self-hosted/install/quickstart` (several code blocks in multiple
languages, deep heading structure). Renderer:
`app/pages/docs-page.tsx` → shared `@tale/ui` markdown stack
(`RoutedMarkdown`, `highlighted-code.tsx`, `anchored-heading.tsx`) +
`app/features/page-actions/page-actions.tsx`.

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode. Clipboard rows
(F2/F5/F6) need a secure context (https or localhost) and clipboard
permission.

> **Agent note**: the code **Copy code** button and the heading **Copy link to
> this section** button are hover/focus-revealed (`opacity-0` until
> `group-hover`/`focus-visible`) — focus or hover their container first. All
> three copy affordances flip to a "copied" label for **1.5 s** with
> `aria-live="polite"`; assert the clipboard content, not the flash. The
> page-actions labels are **hard-coded English** (see [locale.md](locale.md)).

## Automated coverage

| Case(s)                 | Status         | Where                                                                                                                                                               |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (source shape)       | ✅ automated   | vitest `structure-code.test.ts` (every fence declares a language), `structure-headings.test.ts`, `links.test.ts`, `images.test.ts` (image paths resolve + alt text) |
| F1–F8 (rendered), B1–B3 | ⛔ manual-only | — (no e2e renders a content page beyond the smoke shell)                                                                                                            |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test               | Steps (route + control)                                                                                              | Expected (verifiable)                                                                                                                                                                                                                                  |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Code highlighting  | On the quickstart, inspect the `bash` and `powershell` blocks — in **both** themes                                   | Shiki token colouring renders (not a plain `<pre>`); the palette follows the active theme; long blocks (> 12 lines) show line numbers                                                                                                                  |
| F2  | Copy code          | Hover/focus a code block; click **Copy code** (hard-coded aria-label)                                                | The button flips to **Copied** (`aria-live="polite"`, reverts after 1.5 s); the clipboard holds the block's source **without** a trailing newline artefact; paste matches what's displayed                                                             |
| F3  | Heading anchors    | Hover an H2; click the anchor affordance, then click **Copy link to this section**                                   | The heading has a stable GitHub-style id (verified live: `#step-1-install-the-cli`); the URL hash updates; the copy-link button flips to **Link copied** and the clipboard holds the absolute URL incl. hash                                           |
| F4  | Deep link entry    | Open the F3 URL (with hash) in a fresh tab                                                                           | The page loads scrolled to that heading, offset below the sticky header (`scroll-mt`), the right sidebar/TOC state matches ([navigation.md](navigation.md) F5)                                                                                         |
| F5  | Copy page          | Click **Copy page** in the page-actions cluster                                                                      | Button flips to **Copied**; the clipboard holds the page **as markdown** (frontmatter title + body, not HTML)                                                                                                                                          |
| F6  | Open in / .md view | Open the **Open in** menu; inspect **Open in ChatGPT**, **Open in Claude**, **Open in Cursor**, **View as Markdown** | Menu opens (Esc closes, focus returns); the three "Open in" items deep-link to `chatgpt.com` / `claude.ai` / `cursor://` with the page's `.md` URL embedded in the prompt; **View as Markdown** serves `{pageUrl}.md` as plaintext markdown (HTTP 200) |
| F7  | Edit on GitHub     | Click **Edit on GitHub** (`docs.editOnGithub`)                                                                       | Opens `https://github.com/tale-project/tale/edit/main/docs/{locale}/{slug}.md` — the path matches the page actually being read (spot-check on a `/de` page too)                                                                                        |
| F8  | Page metadata      | Read the meta row under the H1                                                                                       | **{n} min read** (`docs.readingTime`) with a plausible n, and — when the build carries a date — **Last updated {date}** (`docs.lastUpdated`)                                                                                                           |

## Boundary & error tests

| ID  | Test                  | Input                                                                                                                 | Expected                                                                                                                                         |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Clipboard unavailable | Deny clipboard permission (or insecure context); click **Copy code**                                                  | No crash — the failure is logged (`console.warn '[code-block] clipboard write failed'`), the button doesn't get stuck in **Copied**              |
| B2  | Images                | Sweep rendered pages for `<img>` (the corpus currently ships none — `images.test.ts` guards paths/alt when they land) | Any image renders (no broken-image icon), has non-empty `alt`, and doesn't overflow its column; record **N/A** if the corpus still has no images |
| B3  | External links        | Click an external link in the body (e.g. the OpenRouter link)                                                         | Opens the external site; external links don't hijack the SPA router; internal links stay client-side navigations                                 |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                                                       |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Copy controls  | All copy affordances are real `<button>`s with accessible names that update on state (**Copy code** → **Copied**), reachable by keyboard (focus reveals the hover-hidden ones) |
| A2  | Content markup | The body is semantic HTML — real headings (levels never skip), `<ul>/<ol>` lists, `<code>`/`<pre>` for code; blockquote asides render as `<blockquote>`                        |
| A3  | Actions menu   | The **Open in** menu is keyboard-operable; Esc closes it and restores focus to the trigger                                                                                     |

## Performance

| ID  | Metric           | Target                                                                                                                                 |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Highlight settle | Code blocks are highlighted **< 1 s** after page render (Shiki runs client-side post-hydration; the plain fallback must never persist) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Content rendering (docs)
Functional: ___/8   Boundary: ___/3   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
