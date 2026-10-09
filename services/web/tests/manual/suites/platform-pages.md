# Platform pages & changelog

> **Prefix** `PAGE-` · **Reset** none · **Cost** 19 boxes

Exercise the marketing pages the 2026-07 site rewrite added — the `/platform`
hub, the six module pages
(`/platform/{chat|projects|knowledge|agents|automations|governance}`), and the
`/changelog` release timeline. Each page is built from the
`app/components/blocks/feature/` family (FeatureHero with a localized real product capture → two topic tours →
capabilities → FAQ → related → docs → CTA, composed by
`app/pages/platform/feature-page-layout.tsx`) with animated demo scenes from
`app/components/blocks/demos/`. Navigation into these pages lives in
[navigation.md](navigation.md); SEO/JSON-LD in [seo.md](seo.md).

## Scope & routes

| Surface          | Route                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| Platform hub     | `/platform` (also `/{lang}/platform`)                                    |
| Platform modules | `/platform/{chat\|projects\|knowledge\|agents\|automations\|governance}` |
| Changelog        | `/changelog` (also `/{lang}/changelog`)                                  |

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — any mode; no sign-in. All
pages render without a backend; `/changelog` renders a **build-time snapshot**
of GitHub Releases (`app/generated/releases-manifest.ts`, fetched by
`scripts/fetch-releases.ts` during `build` — see the SETUP mode-B note), so
its content is only as fresh as the last build.

> **Agent note**: hero images use native `img` alternative text from `demo.pages.*.label`. Each full-screen link opens the complete capture in the page language; Swiss German uses German. Every supporting demo scene is a single illustration for AT —
> `role="img"` with an aria-label from `<namespace>.demos.*.label` — locate
> demos with `getByRole('img', { name: … })` and assert `toContainText` on the
> scene. Under `prefers-reduced-motion: reduce` the timeline driver pins every
> demo to its **final beat**, so end states are assertable without waiting;
> without it, expect typing/streaming animation first.

## Functional tests

- [ ] `PAGE-F1` · **Hub hero** — Open `/platform`, `/de/platform`, and `/fr/platform` → H1 matching `platformHub.title`, a distinct real Inbox capture (`demo.pages.hub.label`), native interface labels, and an example-workspace caption.

- [ ] `PAGE-F2` · **Hub module sampler** — Scroll the tour on `/platform` → Two alternating `DemoShell` rows for Projects and Agents with hub-owned scenarios (`platformHub.demos.{projects,connect}.*`); each Explore link commits the matching module page.

- [ ] `PAGE-F3` · **Hub grid + FAQ + CTA** — Continue below the tour → A
  module card grid (Chat → Projects → Knowledge → Agents → Automations →
  Governance, labels under `nav.product.*`) linking to the module pages; FAQ
  accordions (`platformHub.faq.items`); closing CTA block matching `featureShared.ctaTitle` with **Request a demo** / **Contact us**.
- [ ] `PAGE-F4` · **Module page section stack** — Open `/platform/chat`
  (repeat spot-checks on the other five) → The FeatureHero renders eyebrow
  `platformChat.eyebrow` + H1 matching `platformChat.title` + description, then in order: tour rows with demos →
  capabilities grid (`platformChat.capabilities.*`) → mini-FAQ → **Related
  modules** → **Read the docs** → CTA (`feature-page-layout.tsx` order)
- [ ] `PAGE-F5` · **Chat story** — On `/platform/chat`, inspect the real conversation capture and its two supporting tours → Project context (`platformChat.demos.projects.*`) and shared knowledge (`platformChat.demos.knowledge.*`) show how the conversation connects to the team's work.
- [ ] `PAGE-F6` · **Projects story** — On `/platform/projects`, inspect its real task-board capture and two supporting tours → The relaunch task scene (`platformProjects.demos.tasks.*`) and project chat (`platformProjects.demos.hero.*`) show project-specific content.

- [ ] `PAGE-F7` · **Knowledge story** — On `/platform/knowledge`, inspect the real shared-entries library capture and its two supporting tours → A cited answer (`platformKnowledge.demos.hero.citation1`) and project access (`platformKnowledge.demos.projects.*`) show how shared material supports the team's work.

- [ ] `PAGE-F8` · **Agents story** — On `/platform/agents`, inspect its real runtime/model roster and two supporting tours → Project assignments (`platformAgents.demos.projects.*`) and knowledge access (`platformAgents.demos.knowledge.*`) explain the agents page independently.

- [ ] `PAGE-F9` · **Automations + Governance stories** — On `/platform/automations`, inspect the real completed run plus protected-action and agent tours; on `/platform/governance`, inspect the real audit log plus automation and agent tours → Each page has its own captured state and supporting scenarios.

- [ ] `PAGE-F10` · **Related + docs cross-links** — On any module page, use
  **Related modules** (`featureShared.relatedHeading`) and **Read the docs**
  (`featureShared.docsHeading`) → Related cards commit sibling
  `/platform/{module}` pages (per the page's `related` list in
  `app/content/platform-pages.ts`); docs links open the external docs
  deep-link (`target`/`rel` set) — assert attributes, don't follow.
- [ ] `PAGE-F11` · **Changelog timeline** — Open `/changelog`; click a
  mid-timeline version in the sticky **All releases** nav
  (`changelogPage.allReleases`); scroll the stream → H1 **What's new in
  Tale?** (`changelogPage.title`); newest-first releases with dates and **View
  on GitHub** (`changelogPage.viewOnGithub`); the click commits the `#v…`
  hash, scrolls the release under the header, sets `aria-current="true"` on
  the link, and the sticky nav keeps the active row in view; the footer notes
  the snapshot time (`changelogPage.fetchedAt`)
- [ ] `PAGE-F12` · **Demo animation + chrome** — With **no** reduced-motion
  preference, load `/platform` and watch one scene; inspect window chrome
  across scenes → Scenes animate (typing/streaming beats) and settle at the
  same end state the reduced-motion path pins; chat-style windows show the
  **Share** chrome (`demo.chrome.share`, shipped by `@tale/marketing-ui`) while non-chat windows
  (agents/knowledge/automations/projects) do **not**; approval scenes use
  the Automations title, and chat composers and Arena headers show model
  selectors without a separate project-agent picker.

## Boundary & error tests

- [ ] `PAGE-B1` · **Unknown platform subpage** — Open `/platform/nope`, then
  `/de/platform/nope` → The localized not-found page (`notFound.title` +
  **Back to the homepage**, `notFound.backHome`) — no crash, no blank hub
  fallback; from the built dist the response is HTTP **404** (see
  [seo.md](seo.md) SEO-B1)
- [ ] `PAGE-B2` · **Odd changelog data** — Open `/changelog#v0.0.0-nope`; scan
  the stream for sparse releases → An unknown hash neither crashes nor scrolls
  anywhere (page renders from the top); a release without notes shows **No
  release notes for this version.** (`changelogPage.emptyBody`); a release
  whose GitHub name is just the version renders without a duplicated title
  line (the dedicated untitled-release key was dropped)

## Accessibility (WCAG 2.1 AA)

- [ ] `PAGE-A1` · **Heading order** → One `h1` per page, no skipped levels —
  automated for `/platform` by `smoke.spec.ts`; walk the six module pages and
  `/changelog` manually the same way.
- [ ] `PAGE-A2` · **Image names and framing** → Every hero has a descriptive localized alternative text and keyboard-reachable full-screen link. At 320px, focused crops keep relevant product content visible; desktop framing preserves orientation. Supporting scenes remain `role="img"` with descriptive names, and their inner text/icons are not separately announced.

- [ ] `PAGE-A3` · **Keyboard reach** → Tab reaches every **Explore {module}**
  tour link, module-grid card, FAQ accordion, and changelog timeline link;
  activating a timeline link by keyboard moves `aria-current` and scrolls the
  release; focus stays visible throughout.

## Performance

- [ ] `PAGE-P1` · **Demo scroll cost** → Scrolling `/platform` end-to-end
  stays smooth (no visible jank/long-task stalls from the animated scenes;
  static under reduced motion)
- [ ] `PAGE-P2` · **Changelog render** → `/changelog` (40-release snapshot)
  settles in **< 2 s** on a warm build; a timeline click scrolls and updates
  `aria-current` in **< 500 ms**.
