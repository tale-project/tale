---
name: implement-ui
description: Read before writing or editing any UI — a component, screen, page, route, dialog, or styling change — so you build from the project's design system, not by hand. It is the design-conformance layer — it defers the generic process (note → reuse → slice → verify) to implement-feature / make-improvement and adds the UI rules — compose the component library (never hand-roll what it ships), semantic tokens (never hex), one control system, light + dark, keep design languages separate, localize every user-visible string, meet accessibility AA, and observe the real rendered outcome in every theme. Understand the design system first with design-ui. Never hand-roll a component the library already ships, hardcode a colour, or call a UI change done on a green typecheck alone.
---

# implement-ui

Building UI is **composing the project's component library**, not writing layout HTML. Understand the
design system first with `design-ui` (the surfaces, the tokens, the conventions); this skill is the
design-conformance layer on top of `implement-feature` / `make-improvement` — load whichever fits the
change, then hold the UI rules below.

## When this applies

Writing or editing any UI — a component, screen, route, dialog, an empty / loading / error state, or a
styling change. Adding net-new behaviour is still `implement-feature`; a behaviour-preserving refactor
is still `make-improvement` — this rides on top of whichever applies.

## Write a note first

**Invoke `write-notes`** and answer this UI form before you write code:

- **Surface:** which design language (app / web / docs) and the exact route or component you'll touch.
- **Reuse:** which component(s) from the library you'll compose — name them — and why none fits if you
  must add one.
- **Design match:** which screen / handoff / token group this has to match.
- **Theme & states:** the themes (light / dark) and the empty / loading / error / disabled states in
  scope.

## The rules

Each is a defect if skipped; check how _this_ project enforces it.

1. **Reuse the component library first.** Compose what exists — its button, card, input, table,
   dialog, tooltip — never hand-roll a `div` that the library already ships. Search it
   (`search-codebase`) and **name the component before you write**. A divergent second copy of a
   shipped primitive is the defect, not the feature (the doctrine: `implement-feature`).
2. **Semantic tokens, never hex.** Write the semantic colour / spacing / type token (or its utility),
   never a raw hex or an ad-hoc grey; match the surrounding file's vocabulary. Read the tokens file for
   the live set — see `design-ui`.
3. **One control system.** Use the project's single control-height / sizing scale; don't introduce a
   new size.
4. **Light + dark (every theme).** Drive colour through tokens so it themes; never hardcode a colour
   that won't switch; verify **every** theme the project ships.
5. **Keep design languages separate.** Build the surface you're on with its own components and patterns;
   never cross-apply (a product pattern onto a marketing page, or vice versa) and never pull
   product-only dependencies (data layer, auth) into a marketing or docs surface.
6. **Localize every user-visible string** the way this project does — through its i18n layer, in all
   its locales. A hardcoded user-facing string is a defect. See `write-translations`.
7. **Accessibility AA.** Real semantic HTML, keyboard reachable, visible focus, labelled controls —
   **a real accessible name on every icon-only button** (a tooltip is a description, not a name) —
   sufficient contrast, hit targets ≥ 24×24px. Prove it with the project's a11y tooling.
8. **Skeletons / loading mask in place.** Wrap the real component in the project's skeleton primitive;
   no whole-tree swaps or a bare spinner where a skeleton fits.

## Patterns

- **See the design before you code.** Open the real screen / handoff / Storybook for your surface and
  match it — don't approximate from memory.
- **Name the reuse, then ship a thin slice** — that's the reuse gate from `implement-feature`; do it,
  don't restate it.
- **Observe the real rendered outcome.** Run the app and look at the change in **every theme** and
  every state (`test-code`; browser mechanics: `browse-web`); a green typecheck is not proof. Run the
  framework's component linter after the change (for React, `react-doctor`).

## Gate B — before you call the UI done

**Tick every box, or N/A with a reason — an unticked box means not done.**

- [ ] **Composed the component library** — no hand-rolled layout; the reused component is named.
- [ ] **Semantic tokens only** — no hardcoded hex/grey; verified in every theme.
- [ ] **Right surface** — design languages not crossed; no product-only deps in a marketing/docs surface.
- [ ] **Control + skeleton conventions** — one sizing scale; loading masks in place.
- [ ] **Every user-visible string localized** — all the project's locales.
- [ ] **Accessibility AA** — keyboard, visible focus, accessible names on icon buttons, contrast, hit targets; the a11y tooling is green.
- [ ] **Observed in the real app, every theme** — not just a typecheck; the component linter is clean.
- [ ] **Definition of done** — the shared checklist holds (`create-pr`).

## Companion skills

- `design-ui` — the design language (the _what_): the surfaces, colours, tokens, and conventions.
- `implement-feature` / `make-improvement` — the generic process this layer rides on.
- `search-codebase` — find the component to reuse and every surface that renders it.
- `test-code` — prove the behaviour (happy + edge + error) and the real outcome.
- `write-translations` — read before touching any non-default-language string.
- `create-pr` — take the finished change to a clean PR.
