---
name: implement-feature
description: 'Use this skill whenever you add new behaviour a user or caller can see — a feature, screen, field, route, endpoint, flag, setting, or capability. It is the senior-engineer method: understand the real intent, feel the current product, reuse what already exists before adding anything, ship a thin vertical slice, and prove it works. Load it the moment a task says "add", "build", "support", "create", "implement", or "let users…", or whenever you''re about to write code that resembles something the project may already do. Never start a feature without it. For a behaviour-preserving change use make-improvement; for a defect use fix-bug.'
---

# implement-feature

New behaviour, fully integrated — not a prototype. The two expensive mistakes here are **building the
wrong thing** and **building a second copy of something that already exists** in a different shape. So
you earn the right to write code by first understanding the intent and feeling the ground you stand
on. For a structural or performance change that keeps behaviour the same, use `make-improvement`; for
a defect, `fix-bug`; for the tests, `test-code`; to open the PR, `create-pr`.

## When this applies

Any task that adds behaviour a user or caller can see — a screen, a field, a route, an endpoint, a
setting, a capability. Skip the ceremony only for a one-line change in a place you already know.

## Write a note first

**Invoke `write-notes`** and answer this form before you implement:

- **Intent:** Describe exactly what a user or caller will be able to do that they can't today — and what stays the same.
- **Status quo:** Describe how the area behaves now and how it's built — which files/components own it, and what you saw when you ran or read it.
- **Reuse:** Describe the existing concept you'll build on (name the component / hook / util / endpoint and its path) and how you'll extend or compose it. If you're adding new, explain what you searched for and why nothing fit.
- **Approach:** Describe the thinnest end-to-end slice (data → logic → UI) and how it wires into the code already there.
- **Ripple:** For each area a change of this shape can touch (tests, migration, docs, i18n, a11y), describe what this one requires.
- **Risks & unknowns:** Where are you least confident? Describe the assumption that, if wrong, would break this — and how you'd catch it before it bites.

## Gate A — before you write code

The senior move is to slow down here. **Tick every box, or N/A with a reason — an unticked box means
not done.**

- [ ] **Note** — the form above is answered and written first (`write-notes`).
- [ ] **Intent** — restated in your own words; every design-changing ambiguity **asked, not guessed**
      — a wrong guess wastes the whole feature, and you keep asking the moment you hit a roadblock.
      Facts you lack are researched (`deep-research`); preferences are asked.
- [ ] **Status quo** — you ran or navigated the real app (or exercised the real code path) for the
      area you're extending; you've experienced the current behaviour, not imagined it.
- [ ] **Reuse** — the existing concept is found (`search-codebase`) and **named — or you can say why
      none fits**. Reuse → extend → generalize: a second catalog/list/form that already exists in
      another shape is a defect, not a feature; create new only when nothing fits, in its canonical
      home, under a name the next dev will search for.
- [ ] **Conventions** — discovered from the project's tooling and its neighbouring code
      (`search-codebase` orient), not from memory, so your code passes the gate the first time.
- [ ] **Blast radius** — every other site of the concept and every cross-cutting artifact enumerated
      (`search-codebase` sweep) — and the smallest, most reversible slice picked.

## Build the vertical slice

- **Thinnest end-to-end slice first.** Make the intent work all the way through — data → logic → UI —
  before widening. Avoid gold-plating and speculative generality; build what was asked, well.
- **Match the neighbours exactly.** Mirror the structure, naming, and error handling of the files
  you're in. Code that looks like it was always there is the goal.
- **Validate at every boundary.** Treat all external input (requests, params, payloads, files) as
  adversarial; parse and reject at the edge.

## Gate B — before you call it done

**Tick every box, or N/A with a reason — an unticked box means not done.**

- [ ] **Slice integrated** — the thin slice works end-to-end through real wiring; no dead flags or
      orphaned UI.
- [ ] **Definition of done** — walk `create-pr`'s shared checklist now, not at PR time: green gate,
      tests, migration, locales, docs, accessibility.
- [ ] **Sweep** — every site enumerated at Gate A is changed or explicitly ruled out (`search-codebase`).
- [ ] **Observed** — the real outcome watched (`test-code`), never a green typecheck alone.

Then take it to a clean PR with `create-pr`.

## Patterns

- **Thin slice over big bang.** Five small integrated commits that each keep the suite green beat one
  thousand-line drop nobody can review or revert.
- **The reuse miss you can't see is the costly one.** About to name a new component
  `XList`/`XGrid`/`XPicker`? Stop — `search-codebase` first; the project almost certainly already has
  the concept.
