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

**Invoke `write-notes`** and record your answers to this form before you write any code:

- **Intent:** Describe exactly what a user or caller will be able to do that they can't today — and what stays the same.
- **Status quo:** Describe how the area behaves now and how it's built — which files/components own it, and what you saw when you ran or read it.
- **Reuse:** Describe the existing concept you'll build on (name the component / hook / util / endpoint and its path) and how you'll extend or compose it. If you're adding new, explain what you searched for and why nothing fit.
- **Approach:** Describe the thinnest end-to-end slice (data → logic → UI) and how it wires into the code already there.
- **Ripple:** For each area a change of this shape can touch (tests, migration, docs, i18n, a11y), describe what this one requires.
- **Risks & unknowns:** Where are you least confident? Describe the assumption that, if wrong, would break this — and how you'd catch it before it bites.

## Gate A — before you write any code

The senior move is to slow down here. **Tick every box before the first edit** — you have not earned the
right to implement until they all hold:

- [ ] **Intent restated, the answerable questions clarified upfront.** If the request forks or is
      ambiguous in a way that changes the design, **ask — don't guess**; a wrong guess wastes the whole
      feature. Keep asking the moment you hit a roadblock mid-build.
- [ ] **Felt the status quo.** Ran/navigated the real app (or exercised the real code path) for the area
      you're extending — you've experienced the current UI/UX and adjacent features, not imagined them.
- [ ] **Searched for the existing concept** by vocabulary (the words a user or dev would use — catalog,
      list, picker, invite, …), in order: the design system / shared components → shared app + library
      code → closest sibling feature. **You can name the concept you're reusing — or say why none fits.**
      A second catalog/list/form that already exists in another shape is a defect, not a feature.
- [ ] **Discovered the house conventions** from the enforced sources, not memory — the project's
      linter/formatter/type configs, its commit/CI config, its test setup, and the surrounding code — so
      your code matches and passes the gate the first time.
- [ ] **Decided reuse → extend → generalize.** Create new only when nothing fits, in its canonical home,
      under a name the next dev will search for.
- [ ] **Mapped the blast radius** — who imports/calls this, and what a change of this shape must also
      touch (translations, migrations, docs, tests, accessibility) — and picked the smallest, most
      reversible slice.

## Build the vertical slice

- **Thinnest end-to-end slice first.** Make the intent work all the way through — data → logic → UI —
  before widening. Avoid gold-plating and speculative generality; build what was asked, well.
- **Match the neighbours exactly.** Mirror the structure, naming, and error handling of the files
  you're in. Code that looks like it was always there is the goal.
- **Validate at every boundary.** Treat all external input (requests, params, payloads, files) as
  adversarial; parse and reject at the edge.

## Gate B — before you call it done

**Tick every box, or mark it N/A with a reason.** The concept is universal; check how _this_ project
enforces each. An unticked box means not done — don't claim otherwise.

- [ ] **Tests carry the feature** — happy path + one edge + one error, and you watched them pass.
- [ ] **A data-model change ships its migration** in the same change — reversible and tested.
- [ ] **Every user-visible string is localized** the way this project does it — all its locales.
- [ ] **Docs updated** for anything a user can see, configure, or call.
- [ ] **Accessibility** for any UI — real elements, keyboard reachable, labelled, sufficient contrast.
- [ ] **Verified by observing the real outcome** — you ran it and watched it behave, not "it compiles".
- [ ] **The gate is green** — the project's format/lint/typecheck/test command passes.

Then take it to a clean PR with `create-pr`.

## Patterns

- **Thin slice over big bang.** Five small integrated commits that each keep the suite green beat one
  thousand-line drop nobody can review or revert.
- **The reuse miss you can't see is the costly one.** If you're about to name a new component
  `XList`/`XGrid`/`XPicker`, stop and grep the words first — the project almost certainly already has
  the concept.
