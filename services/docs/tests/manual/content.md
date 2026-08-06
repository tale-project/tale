# Content rendering — Manual Test Plan

> **Purpose**: Exercise how a docs page renders and what a reader can do with
> it — syntax-highlighted code blocks with copy buttons, heading deep links
> (anchor + copy-link), the page-actions cluster (**Copy page**, **Open in**,
> the `.md` view), **Edit on GitHub**, reading-time/last-updated metadata, the
> markdown component vocabulary (steps, tabs, callouts, cards, frames, code
> groups), screenshots with click-to-zoom, and the tutorial video player.
> Source-level integrity (every link resolves, every fence has a language,
> every image and video asset exists) is already automated by the vitest
> content suite — this guide covers the **rendered** behaviour it can't see.

## Scope & routes

One representative page per component family (picked by corpus grep — usage
counts across `docs/en/`: Card ×89, Frame ×45, Step ×40, Note ×24, Video ×19,
CardGroup ×18, Warning ×12, Tab ×12, Steps ×11, Check ×8, Info ×6, Tip ×4,
Tabs ×4, CodeGroup ×1):

| Surface                       | Route                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Code blocks, Steps, Tabs      | `{base}/self-hosted/install/quickstart` (bash + powershell fences inside Tabs) |
| Callouts (Info, Tip)          | `{base}/platform/models`                                                       |
| Callout (Warning) + Frame     | `{base}/platform/connectors/webdav`                                            |
| Cards / CardGroup             | `{base}/` (landing card groups)                                                |
| Frame with caption            | `{base}/platform/chat/overview`                                                |
| CodeGroup (corpus's only one) | `{base}/self-hosted/configuration/providers`                                   |
| Images                        | `{base}/platform/chat/basics` (2 screenshots)                                  |
| Video                         | `{base}/tutorials/videos/welcome-to-tale` (episode 1)                          |

Renderer: `app/pages/docs-page.tsx` → shared `@tale/ui` markdown stack
(`RoutedMarkdown`, `highlighted-code.tsx`, `anchored-heading.tsx`, component
registry `packages/ui/src/markdown/components/registry.tsx`) +
`app/features/page-actions/page-actions.tsx`. Images and videos go through the
docs-specific overrides `app/components/docs/docs-image.tsx` /
`docs-video.tsx`, which rebase root-absolute srcs (`/images/…`, `/videos/…`)
onto the deploy base path (`rebaseImageSrc`) — under mode A every asset URL
must start with the **/docs/** prefix.

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode. Clipboard rows
(F2/F5/F6) need a secure context (https or localhost) and clipboard
permission.

> **Agent note**: the code **Copy code** button and the heading **Copy link to
> this section** button are hover/focus-revealed (`opacity-0` until
> `group-hover`/`focus-visible`) — focus or hover their container first. All
> three copy affordances flip to a "copied" label for **1.5 s** with
> `aria-live="polite"`; assert the clipboard content, not the flash. The
> page-actions labels are i18n-wired (`docs.pageActions.*`); the code-copy and
> heading-link labels are still **hard-coded English** (see
> [locale.md](locale.md)). `<Step title>` renders a plain `<h3>` with **no
> id** (`packages/ui/src/markdown/components/steps.tsx`) — Step titles are not
> deep-linkable and never appear in the **On this page** TOC; anchor rows must
> target real markdown H2/H3s.

## Automated coverage

| Case(s)                          | Status         | Where                                                                                                                                                                      |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (source shape)                | ✅ automated   | vitest `structure-code.test.ts` (every fence declares a language), `structure-headings.test.ts`, `links.test.ts`                                                           |
| F15–F16 (image sources)          | 🔶 partial     | vitest `images.test.ts` (paths resolve, alt text, size) + `image-manifest.test.ts` (manifest entry, page reference, DPR-2 dimensions) — rendered behaviour manual          |
| F17–F18 (video sources)          | 🔶 partial     | vitest `videos.test.ts` (manifest ↔ disk parity, all-locales-or-none per episode, embed src/poster/captions resolve + match page locale, size budgets, well-formed WebVTT) |
| F9–F14 (component tags mirrored) | 🔶 partial     | vitest `locale-components.test.ts` (DE/FR mirrors use the same component tags in the same order) — rendering manual                                                        |
| F1–F18 (rendered), B1–B3         | ⛔ manual-only | — (no e2e renders a content page beyond the smoke shell)                                                                                                                   |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test               | Steps (route + control)                                                                                                      | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Code highlighting  | On the install quickstart, inspect the `bash` (macOS / Linux tab) and `powershell` (Windows tab) blocks — in **both** themes | Shiki token colouring renders (not a plain `<pre>`); the palette follows the active theme; long blocks (> 12 lines) show line numbers                                                                                                                                                                                                                                                           |
| F2  | Copy code          | Hover/focus a code block; click **Copy code** (hard-coded aria-label)                                                        | The button flips to **Copied** (`aria-live="polite"`, reverts after 1.5 s); the clipboard holds the block's source **without** a trailing newline artefact; paste matches what's displayed                                                                                                                                                                                                      |
| F3  | Heading anchors    | On the install quickstart, hover the H2 **Before you begin**; click the anchor, then **Copy link to this section**           | The heading has a stable GitHub-style id (`#before-you-begin` — its real H2s are Before you begin / From zero to signed in / Prefer raw Docker Compose? / Troubleshooting / Where this gets used); the URL hash updates; the copy-link button flips to **Link copied** and the clipboard holds the absolute URL incl. hash. Step titles (h3, no id) are **not** anchorable — see the agent note |
| F4  | Deep link entry    | Open the F3 URL (with hash) in a fresh tab                                                                                   | The page loads scrolled to that heading, offset below the sticky header (`scroll-mt`), the right sidebar/TOC state matches ([navigation.md](navigation.md) F5)                                                                                                                                                                                                                                  |
| F5  | Copy page          | Click **Copy page** (`docs.pageActions.copyPage`) in the page-actions cluster                                                | Button flips to **Copied**; the clipboard holds the page **as markdown** (frontmatter title + body, not HTML)                                                                                                                                                                                                                                                                                   |
| F6  | Open in / .md view | Open the **Open in** menu; inspect **Open in ChatGPT**, **Open in Claude**, **Open in Cursor**, **View as Markdown**         | Menu opens (Esc closes, focus returns); the three "Open in" items deep-link to `chatgpt.com` / `claude.ai` / `cursor://` with the page's `.md` URL embedded in the prompt; **View as Markdown** serves `{pageUrl}.md` as plaintext markdown (HTTP 200)                                                                                                                                          |
| F7  | Edit on GitHub     | Click **Edit on GitHub** (`docs.editOnGithub`)                                                                               | Opens `https://github.com/tale-project/tale/edit/main/docs/{locale}/{slug}.md` — the path matches the page actually being read (spot-check on a `/de` page too)                                                                                                                                                                                                                                 |
| F8  | Page metadata      | Read the meta row under the H1                                                                                               | **{n} min read** (`docs.readingTime`) with a plausible n, and — when the build carries a date — **Last updated {date}** (`docs.lastUpdated`)                                                                                                                                                                                                                                                    |
| F9  | Steps list         | On the install quickstart, read the **From zero to signed in** step sequence                                                 | An ordered list with numbered circular markers (1, 2, 3…) on a left border rail; each `<Step title>` renders its title as an `<h3>`; step bodies keep full markdown (fences, tabs, callouts nest inside)                                                                                                                                                                                        |
| F10 | Tabs switch        | In the **Install the CLI** step, click **Windows (PowerShell)**, then back to **macOS / Linux**; try ArrowLeft/ArrowRight    | Real `role="tablist"`/`role="tab"` semantics with `aria-selected`; clicking (or arrow keys on a focused tab) swaps the visible panel — the powershell fence shows only under the Windows tab; switching never navigates or scrolls the page                                                                                                                                                     |
| F11 | Callout flavors    | Compare **Info**/**Tip** on `{base}/platform/models`, **Warning** on the WebDAV page, **Note**/**Check** on the quickstart   | Each renders as an `<aside role="note">` with a distinct icon and tint per flavor (Note neutral, Tip/Check green, Info blue, Warning amber); links and inline code inside callouts stay readable (full-contrast foreground)                                                                                                                                                                     |
| F12 | Cards link         | On `{base}/`, inspect the card groups; click a card (e.g. the quickstart card)                                               | Cards render title + icon in bordered tiles (multi-column grid per `cols`); the whole card is a link — clicking commits its `href` as a client-side navigation (no full reload)                                                                                                                                                                                                                 |
| F13 | Frames             | On `{base}/platform/chat/overview`, inspect the framed screenshots                                                           | Each `<Frame>` renders a bordered figure; the `caption` text renders below the content as a `<figcaption>`                                                                                                                                                                                                                                                                                      |
| F14 | Code group         | On `{base}/self-hosted/configuration/providers`, drive the `<CodeGroup>`                                                     | One bordered panel with a `role="tablist"` header naming each variant; switching tabs swaps the code panel instantly (panels stay mounted); each panel keeps its own **Copy code** button copying only the visible variant                                                                                                                                                                      |
| F15 | Images render      | On `{base}/platform/chat/basics`, inspect both screenshots — **in mode A** (or any base-path deploy) if possible             | Both `.webp` images render (no broken-image icon), with non-empty descriptive `alt`, `loading="lazy"`, inside the body column (no overflow); the served src is rebased under the deploy base path — `/docs/images/platform/…` on mode A, never a bare `/images/…` that 404s                                                                                                                     |
| F16 | Image zoom         | Click a screenshot; then close via **Esc**, the backdrop, and the close button (three separate opens)                        | The trigger is a `cursor-zoom-in` button; a lightbox opens over a dimmed blurred overlay showing the image near full-viewport; Esc, clicking the backdrop, and the **Close** button each dismiss it and the page position is unchanged                                                                                                                                                          |
| F17 | Video playback     | On `{base}/tutorials/videos/welcome-to-tale`, play the episode                                                               | The player shows the poster (`.webp`) before play with native `controls`; pressing play streams the `.mp4` (episode 1 ≈ 4:07); the figure caption under the player names the episode; captions are **off** by default                                                                                                                                                                           |
| F18 | Video captions     | In the player's captions menu, enable the track; repeat on the `/de` mirror of the page                                      | A captions track is present (`kind="captions"`, labelled **English** on EN); enabling it renders WebVTT cues in sync; on `/de` the embed's mp4/vtt/poster are the **German** assets (`/videos/de/…`, track labelled **Deutsch**) — a German page never plays the English narration                                                                                                              |

## Boundary & error tests

| ID  | Test                  | Input                                                                    | Expected                                                                                                                                      |
| --- | --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Clipboard unavailable | Deny clipboard permission (or insecure context); click **Copy code**     | No crash — the failure is logged (`console.warn '[code-block] clipboard write failed'`), the button doesn't get stuck in **Copied**           |
| B2  | External links        | Click an external link in the body (e.g. the OpenRouter link)            | Opens the external site; external links don't hijack the SPA router; internal links stay client-side navigations                              |
| B3  | Narrow viewport media | At ≤ 400 px width, open the images page and a videos page; zoom an image | Images and the video player shrink to the column (no horizontal scroll); the zoom lightbox still opens, fits the viewport, and closes cleanly |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                                                                                                                                                                                     |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Copy controls     | All copy affordances are real `<button>`s with accessible names that update on state (**Copy code** → **Copied**), reachable by keyboard (focus reveals the hover-hidden ones)                                                               |
| A2  | Content markup    | The body is semantic HTML — real headings (levels never skip), `<ul>/<ol>` lists, `<code>`/`<pre>` for code; callouts are `<aside role="note">` with an `aria-label` naming the flavor; frames and videos are `<figure>` with `<figcaption>` |
| A3  | Actions menu      | The **Open in** menu is keyboard-operable; Esc closes it and restores focus to the trigger                                                                                                                                                   |
| A4  | Image zoom dialog | The zoom trigger is a focusable button named by the image's alt; the lightbox is a real dialog — focus is trapped inside, Esc closes it, focus returns to the trigger; the close button carries an accessible name (**Close**)               |
| A5  | Tabs semantics    | Tabs/CodeGroup are `role="tablist"`/`role="tab"` with `aria-selected`; Arrow/Home/End move focus between tabs; the active panel is reachable by Tab                                                                                          |
| A6  | Video keyboard    | Tab reaches the native player controls; play/pause and the captions toggle operate by keyboard; enabling captions is possible without a pointer                                                                                              |

## Performance

| ID  | Metric           | Target                                                                                                                                               |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Highlight settle | Code blocks are highlighted **< 1 s** after page render (Shiki runs client-side post-hydration; the plain fallback must never persist)               |
| P2  | Video weight     | A videos page loads light: `preload="metadata"` — the network tab shows no bulk `.mp4` transfer before play (posters are `.webp`, budgeted < 250 KB) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Content rendering (docs)
Functional: ___/18   Boundary: ___/3   A11y: ___/6   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
