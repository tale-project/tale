---
name: design-ui
description: Read this before any visual or UI work — building or changing a screen, component, page, route, or styling — so you build to the project's design system instead of inventing one. A product's UI is usually more than one design language (a dense product app, a marketing site, docs) that share a substrate but are not interchangeable. This skill is the literacy: locate the design system — its design docs, its design tokens, its component library — learn the token vocabulary, and identify which surface you're on. Building to it is implement-ui. Never design a surface from imagination, hardcode a colour the token system already names, or copy one surface's patterns onto another.
---

# design-ui

A product's UI is rarely one design language — most products run a **dense product app**, a **marketing
site**, and **docs** side by side. They often share a component/token substrate, but they are **not
interchangeable**: a marketing hero is not a dashboard pattern. So before you touch a pixel you locate
the design system and learn which surface you're on. This skill is the _what_; building to it is
`implement-ui`. For the generic process around the change, `implement-feature` / `make-improvement`.

## When this applies

Any visual or UI work — a screen, component, page, route, dialog, empty/loading/error state, or a
styling change — and any time you're reading the project's design files or asking what a colour,
token, spacing, type, or theme should be. First decision every time: **which surface**.

## Find the design system first

Don't memorize values — **read the project's own sources**, which can't drift:

- **Design docs / handoff** — a `design/` (or `docs/design`) directory, a `DESIGN.md`, a design-tool
  export, or a Storybook. This is where the project documents its surfaces and conventions; the
  project's `AGENTS.md` / `README` usually points to it.
- **Design tokens** — the tokens file or theme stylesheet (semantic, themed light/dark). These define
  the colours, spacing, radii, type, and motion you're allowed to use.
- **Component library** — the shared UI package. It is the catalogue of what already exists; reuse
  beats rebuild.

If the project documents where these live, go there. If it doesn't, the component library and the
tokens file _are_ the spec — read them before you design.

## What to extract

- **The surfaces and their boundaries.** Which design languages exist (app / web / docs / …), what
  each is for, and the rule that you never cross-apply one's patterns onto another. Product-only
  dependencies (a data layer, auth, an app shell) belong to the app surface — never pull them into a
  marketing or docs surface.
- **The token vocabulary.** Colour, spacing, type, and radii come from **semantic, themed tokens** —
  never a raw hex. Learn the names the project uses and which to reach for; match the surrounding code.
- **The system rules each project codifies** — find them, don't assume: one control-height system, one
  bordered-surface / card primitive, the skeleton / loading convention, the icon set, the font, the
  motion language, and how dark/light theming is wired.
- **The accessibility bar** — almost always WCAG AA: real elements, keyboard reachable, visible focus,
  labelled controls, sufficient contrast, adequate hit targets.

## Patterns

- **Read the design before you reason about it.** Open the actual screen / handoff / Storybook for the
  surface you're on; don't design from a remembered impression.
- **Name the surface, then the tokens, then the components.** "This is the marketing site → its
  marketing-chrome components + the brand tokens" is a complete answer; "a blue button" is not.
- **A second copy of a shipped primitive is the tell.** If the design system already has a card, a
  list, a dialog, you're describing a variant of it — not a new thing.

## Companion skills

- `implement-ui` — read when you're about to **build** UI to the design system you just learned.
- `implement-feature` / `make-improvement` — the generic process the UI change rides on.
- `write-translations` — read before touching any user-visible string in a non-default language.
