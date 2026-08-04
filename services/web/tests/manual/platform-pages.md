# Platform pages & changelog — Manual Test Plan

> **Purpose**: Exercise the marketing pages the 2026-07 site rewrite added —
> the `/platform` hub, the six module pages
> (`/platform/{chat|projects|knowledge|agents|automations|governance}`), and
> the `/changelog` release timeline. Each page is built from the
> `app/components/blocks/feature/` family (FeatureHero → demo tour →
> capabilities → FAQ → related → docs → CTA, composed by
> `app/pages/platform/feature-page-layout.tsx`) with animated demo scenes
> from `app/components/blocks/demos/`. Navigation into these pages lives in
> [navigation.md](navigation.md); SEO/JSON-LD in [seo.md](seo.md).

## Scope & routes

| Surface          | Route                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| Platform hub     | `/platform` (also `/{lang}/platform`)                                    |
| Platform modules | `/platform/{chat\|projects\|knowledge\|agents\|automations\|governance}` |
| Changelog        | `/changelog` (also `/{lang}/changelog`)                                  |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — any mode; no sign-in. All pages
render without a backend; `/changelog` renders a **build-time snapshot** of
GitHub Releases (`app/generated/releases-manifest.ts`, fetched by
`scripts/fetch-releases.ts` during `build` — see the SETUP mode-B note), so
its content is only as fresh as the last build.

> **Agent note**: every demo scene is a single illustration for AT —
> `role="img"` with an aria-label from `<namespace>.demos.*.label` — locate
> demos with `getByRole('img', { name: … })` and assert `toContainText` on the
> scene. Under `prefers-reduced-motion: reduce` the timeline driver pins every
> demo to its **final beat**, so end states are assertable without waiting;
> without it, expect typing/streaming animation first.

## Automated coverage

| Case(s)                        | Status         | e2e spec                                                                                                |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| F1–F2                          | 🔶 partial     | `home-demos.spec.ts` (hub samples each module story; tour stages deep-link) + `smoke.spec.ts` (renders) |
| F4                             | 🔶 partial     | `smoke.spec.ts` (each module page renders; heading order on `/platform`) — section stack not asserted   |
| F5–F9                          | 🔶 partial     | `home-demos.spec.ts` (per-page demo stories under reduced motion, distinct from the homepage scenarios) |
| F11                            | 🔶 partial     | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click)                            |
| A1                             | 🔶 partial     | `smoke.spec.ts` (single `h1` / no skipped levels — `/platform` and `/pricing` only)                     |
| A2                             | 🔶 partial     | `home-demos.spec.ts` (every demo located by `role="img"` accessible name)                               |
| F3, F10, F12, B1–B2, A3, P1–P2 | ⛔ manual-only | —                                                                                                       |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                             | Steps (route + control)                                                                                                                                                                   | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Hub hero                         | Open `/platform`                                                                                                                                                                          | H1 **How does the Tale platform work?** (`platformHub.title`) with its hero demo (`platformHub.demos.hero.label`) telling a hub-specific story — its prompt (`platformHub.demos.hero.prompt`) is **not** the homepage's (`home.demos.hero.prompt`)                                                                                                                          |
| F2  | Hub module sampler               | Scroll the tour on `/platform`                                                                                                                                                            | Six alternating tour rows, one per module, each a `DemoShell` window with a hub-owned scenario (`platformHub.demos.{connect,knowledge,automation,govern,arena,projects}.*`); each row's **Explore {module}** link (`home.tour.explore` + the `nav.product.*` label) commits the matching `/platform/{module}` page                                                          |
| F3  | Hub grid + FAQ + CTA             | Continue below the tour                                                                                                                                                                   | A module card grid (Chat → Projects → Knowledge → Agents → Automations → Governance, labels under `nav.product.*`) linking to the module pages; FAQ accordions (`platformHub.faq.items`); closing CTA block **See Tale on your stack** (`featureShared.ctaTitle`) with **Request a demo** / **Contact us**                                                                  |
| F4  | Module page section stack        | Open `/platform/chat` (repeat spot-checks on the other five)                                                                                                                              | The FeatureHero renders eyebrow **Chats** (`platformChat.eyebrow`) + H1 **Chats in Tale** (`platformChat.title`) + description, then in order: tour rows with demos → capabilities grid (`platformChat.capabilities.*`) → mini-FAQ → **Related modules** → **Read the docs** → CTA (`feature-page-layout.tsx` order)                                                        |
| F5  | Chat story: Arena                | On `/platform/chat`, find the Arena demo (`platformChat.demos.arena.label`)                                                                                                               | The scene duels one announcement prompt (`platformChat.demos.arena.prompt`) across two model columns side by side — content distinct from the homepage Arena scene (`home.demos.arena.prompt`)                                                                                                                                                                              |
| F6  | Projects story                   | On `/platform/projects`, walk its demos (labels under `platformProjects.demos.*`)                                                                                                         | The relaunch-workspace story runs through the project list (`platformProjects.demos.projects.project1`), a tasks board (`platformProjects.demos.tasks.*`), a project chat, and granted knowledge — all distinct from the homepage scenes                                                                                                                                    |
| F7  | Knowledge story                  | On `/platform/knowledge`, find the knowledge demo (`platformKnowledge.demos.knowledge.label`) and the hero chat                                                                           | The pool lists indexed sources (`platformKnowledge.demos.knowledge.source1`); the hero chat reply cites the indexed manual (`platformKnowledge.demos.hero.citation1`)                                                                                                                                                                                                       |
| F8  | Agents story                     | On `/platform/agents`, find the roster (`platformAgents.demos.connect.label`) and sandbox scene (`platformAgents.demos.sandbox.label`)                                                    | The agents page shows its **own** roster (`platformAgents.demos.connect.agent2` — not the homepage roster) and a sandbox window with a **Files** tree + active file (`platformAgents.demos.sandbox.activeFile`) and a **Live** browser pane (`platformAgents.demos.sandbox.browserTitle`)                                                                                   |
| F9  | Automations + Governance stories | On `/platform/automations`, find the pipeline demo (`platformAutomations.demos.automation.label`); on `/platform/governance`, the approval demo (`platformGovernance.demos.govern.label`) | The invoice pipeline shows its trigger (`platformAutomations.demos.automation.trigger`) awaiting approval; the governance scene holds a knowledge write for approval (`platformGovernance.demos.govern.approvalTitle`) with an audit trail (`platformGovernance.demos.govern.audit3`)                                                                                       |
| F10 | Related + docs cross-links       | On any module page, use **Related modules** (`featureShared.relatedHeading`) and **Read the docs** (`featureShared.docsHeading`)                                                          | Related cards commit sibling `/platform/{module}` pages (per the page's `related` list in `app/content/platform-pages.ts`); docs links open the external docs deep-link (`target`/`rel` set) — assert attributes, don't follow                                                                                                                                              |
| F11 | Changelog timeline               | Open `/changelog`; click a mid-timeline version in the sticky **All releases** nav (`changelogPage.allReleases`); scroll the stream                                                       | H1 **What's new in Tale?** (`changelogPage.title`); newest-first releases with dates and **View on GitHub** (`changelogPage.viewOnGithub`); the click commits the `#v…` hash, scrolls the release under the header, sets `aria-current="true"` on the link, and the sticky nav keeps the active row in view; the footer notes the snapshot time (`changelogPage.fetchedAt`) |
| F12 | Demo animation + chrome          | With **no** reduced-motion preference, load `/platform` and watch one scene; inspect window chrome across scenes                                                                          | Scenes animate (typing/streaming beats) and settle at the same end state the reduced-motion path pins; chat-style windows show the **Share** chrome (`home.demos.chrome.share`) while non-chat windows (agents/knowledge/automation) do **not**                                                                                                                             |

## Boundary & error tests

| ID  | Test                     | Input                                                              | Expected                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Unknown platform subpage | Open `/platform/nope`, then `/de/platform/nope`                    | The localized not-found page (`notFound.title` + **Back to the homepage**, `notFound.backHome`) — no crash, no blank hub fallback; from the built dist the response is HTTP **404** (see [seo.md](seo.md) B1)                                                                                                        |
| B2  | Odd changelog data       | Open `/changelog#v0.0.0-nope`; scan the stream for sparse releases | An unknown hash neither crashes nor scrolls anywhere (page renders from the top); a release without notes shows **No release notes for this version.** (`changelogPage.emptyBody`); a release whose GitHub name is just the version renders the `changelogPage.untitledRelease` pattern instead of a duplicate title |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                                                                                                                                                                                                                       |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Heading order  | One `h1` per page, no skipped levels — automated for `/platform` by `smoke.spec.ts`; walk the six module pages and `/changelog` manually the same way                                                                                                          |
| A2  | Demo names     | Every demo scene is `role="img"` with a descriptive aria-label (under `platformHub.demos.*` and each module page's `.demos.*` group, e.g. `platformChat.demos.arena.label`) that names what the animation shows; inner text/icons are not separately announced |
| A3  | Keyboard reach | Tab reaches every **Explore {module}** tour link, module-grid card, FAQ accordion, and changelog timeline link; activating a timeline link by keyboard moves `aria-current` and scrolls the release; focus stays visible throughout                            |

## Performance

| ID  | Metric           | Target                                                                                                                                       |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Demo scroll cost | Scrolling `/platform` end-to-end stays smooth (no visible jank/long-task stalls from the animated scenes; static under reduced motion)       |
| P2  | Changelog render | `/changelog` (40-release snapshot) settles in **< 2 s** on a warm build; a timeline click scrolls and updates `aria-current` in **< 500 ms** |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Platform pages & changelog (web)
Functional: ___/12   Boundary: ___/2   A11y: ___/3   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
