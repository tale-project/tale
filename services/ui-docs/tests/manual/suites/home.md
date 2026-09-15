# Front page

> **Prefix** `HOME-` · **Reset** none · **Cost** ~15 min

The marketing front page at `/` — the one route on this site in the
**marketing** design language (`@tale/marketing-ui`): the `SiteHeader`, the
hero, the product window built from the shipped `@tale/ui` components, the
section cards, the install band and the closing call to action. Everything
under `/docs` is a different language and has its own suite
([docs.md](docs.md)).

## Scope & routes

| Surface           | Route / source                                                                 |
| ----------------- | ------------------------------------------------------------------------------ |
| Front page        | `{base}/`                                                                      |
| Chrome            | `app/components/home/site-chrome.tsx` (`SiteHeader`, the compact footer bar)   |
| Product window    | `app/components/home/home-showcase.tsx` (`DemoStage` + `DemoShell`)            |
| Page composition  | `app/pages/home-page.tsx`                                                      |

## Preconditions

The dev server up per [`../setup.md`](../setup.md), a 1440×900 viewport, the OS
in light mode, `prefers-reduced-motion` **off** unless a box says otherwise.

> **Agent note**: the sections below the hero fade in when scrolled into view
> (`Reveal`, opacity-only). A full-page screenshot taken without scrolling shows
> them blank — that is the motion contract, not a finding (`HOME-8` judges it).

## Boxes

- [ ] `HOME-1` · **Open `/`** → the header carries the logo, **Docs**,
  **Components**, **GitHub** and the theme control; the hero reads **The Tale
  design system** with one sentence under it and the pair **Read the docs** /
  **View on GitHub**; the page sits on the marketing paper (`bg-surface-site`),
  not the app's flat background.
- [ ] `HOME-2` · **Activate Read the docs, then the browser Back button** → the
  first click lands on `/docs/getting-started/introduction` in the app chrome;
  Back returns to `/` with the marketing chrome, and neither transition leaves
  a stale header behind.
- [ ] `HOME-3` · **Scroll to Components in a sample workspace** → the heading
  and its sentence sit **above** the product window; the window shows
  **Workspace settings** with the General tab (a name field, a Data region
  select, a Weekly digest switch) and a Members tab holding a three-row table
  with status badges.
- [ ] `HOME-4` · **Switch the theme to Dark from the header, then to Light** →
  the product window follows each switch (its fields, tabs and table re-skin
  with the page — it reads the same tokens), and the switch survives a reload.
- [ ] `HOME-5` · **Tab through the product window** → nothing inside it takes
  focus (it is a labelled illustration — `role="img"`, inert); focus moves from
  the hero's second call to action straight to the section cards.
- [ ] `HOME-6` · **Activate each of the five cards under Where to go next** →
  Getting started, Foundations, Components, Patterns and Marketing UI each open
  their section's first page (`introduction`, `colors`, `button`, `list-page`,
  `overview`) in the app chrome.
- [ ] `HOME-7` · **Copy the package.json snippet from the install band** → the
  copy button announces success, the clipboard holds the exact block including
  `"@tale/ui": "github:tale-project/tale#dist/ui"`, and **Read the installation
  guide** opens `/docs/getting-started/installation`.
- [ ] `HOME-8` · **Reload with `prefers-reduced-motion: reduce` emulated** →
  every section is visible immediately with no fade; without the emulation each
  section fades in once as it scrolls into view and never fades out again.
- [ ] `HOME-9` · **Resize to 393 px wide** → the header collapses to the logo,
  the theme control and **Open navigation menu**; the menu lists Docs,
  Components and GitHub; the hero, the window and the cards stack in one column
  with no horizontal scrollbar.
- [ ] `HOME-10` · **Read the footer** → the copyright line names the current
  year and Ruler GmbH, the licence line is present, and **llms.txt** opens the
  plain-text index while **GitHub** opens the repository.
