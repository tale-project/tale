---
name: clean-code
description: Universal clean-code discipline for Tale — intention-revealing names, small single-purpose functions, comments that explain why, fail-fast error handling, immutability, and (crucially) the reuse-and-centralization procedure: search packages/ui → shared app/lib → feature before writing anything new. Read before writing ANY code — naming, function shape, error handling, comments, and crucially whether to reuse existing code instead of writing new. Language specifics live in typescript / react / ui-components / convex.
---

# clean-code

The language-agnostic baseline for every line written in this repo, and the canonical home for the
**reuse and centralization** procedure that [`AGENTS.md`](../../../AGENTS.md) summarizes. This skill is
the _why_ and the _how_; the per-language guides own the syntax —
[`typescript`](../typescript/SKILL.md), [`react`](../react/SKILL.md),
[`ui-components`](../ui-components/SKILL.md), [`convex`](../convex/SKILL.md). When a rule here is
sharpened for a language (e.g. snake_case filenames in Convex), the language guide wins for that case.

## When this applies

Before you write or change code in any workspace, in any language. Especially before you _create_
something — a component, hook, util, type, validator, or constant — because the cheapest reuse miss to
catch is the one you haven't made yet. For the syntax of a specific stack, read its guide; come here
for naming, function shape, error handling, comments, and the reuse decision.

## The rules

- **Optimize for the reader, not the writer.** Code is read far more than written. Prefer the obvious
  over the clever; a junior should follow it without you in the room.
- **Intention-revealing names; no abbreviations.** `activeMemberships`, not `am`/`data`/`tmp`. Use one
  word per concept across the codebase (don't mix `fetch`/`get`/`load` for the same idea) — consistent
  vocabulary lets grep and the next reader find things.
- **Small, single-purpose functions.** One job, one level of abstraction. If you need "and" to
  describe it, split it. Smaller units are testable and reusable — the unit of reuse is the function.
- **Guard clauses over deep nesting.** Return early on the error/edge case; keep the happy path flat
  and at the left margin. Deep `if`/`else` pyramids hide the main flow.
- **Command/query separation.** A function either _does_ something or _answers_ something, never both.
  A getter that mutates is a trap for every caller.
- **Few or no flag arguments.** A boolean param that switches behaviour is two functions wearing one
  name — split them so the call site reads true.
- **Named constants, no magic values.** A bare `3600` or `'pending'` hides intent; name it
  (`SESSION_TTL_SECONDS`). The name is the documentation, and there's one place to change it.
- **Comments explain _why_, not _what_.** The code says what. Reserve comments for intent, trade-offs,
  and non-obvious constraints. **No status comments** (`// REFACTORED`, `// TODO #123`) and **no
  commented-out code** — git is the record (matches [`AGENTS.md` code style](../../../AGENTS.md)).
- **Fail fast at boundaries; never swallow errors.** Validate input where it enters the system; throw
  typed/structured errors close to the cause. **No empty catch** — log (`console.warn`/`console.error`)
  or re-throw (code-style rule). Silent catches hide bugs. User-facing errors say _what_ went wrong
  _and how_ to recover.
- **Prefer immutability and pure functions.** Default to `const`; compute new values rather than
  mutating shared state. Pure functions are trivial to test and reason about; shared mutable state is
  where race conditions and spooky action live.
- **Rule of three before abstracting.** Clarity beats premature DRY: a little duplication is cheaper
  than the wrong abstraction. Extract on the _second_ real use; generalize at the third — see Reuse.
- **High cohesion, low coupling; one concept per file.** Things that change together live together;
  modules depend on stable interfaces, not each other's internals. Filenames are **dash-case**
  (snake_case in Convex), **named exports only, no barrels** (default exports resist renaming and break
  grep).
- **Delete dead code; readability over cleverness.** `knip` flags unused exports — an unused symbol is
  usually the _symptom of a missed reuse_. Remove it rather than leaving it to rot.

## Reuse and centralization (the canonical procedure)

Architecture drifts when agents write new instead of looking first — three near-identical buttons,
four date formatters, a feature-local copy of a shared hook. Before you create **any** component,
hook, util, type, validator, or constant, walk this order and stop at the first hit:

1. **Design system** — [`packages/ui`](../../../packages/ui/) (Button, Input, Badge, Dialog,
   Skeletonize, …). A UI need almost always already has a primitive.
2. **Shared app/lib code** — top-level [`app/`](../../../services/platform/app/) (`components`,
   `hooks`, `lib`) for frontend; [`convex/lib/`](../../../services/platform/convex/lib/) and
   [`lib/shared/`](../../../services/platform/lib/shared/) for backend.
3. **The feature** — a sibling in the feature's own folder to extend.
4. Only if nothing fits, **create — in its canonical home, once.**

- **Compose or extend, don't clone.** Never duplicate a primitive's role; add a `variant`/prop or
  compose it. Duplication forks behaviour — a bug fixed in one copy stays alive in the others.
- **New shared primitive → `packages/ui`, with a Storybook story** (all variants + a11y), never a
  one-off in a feature folder. **Extract on the second use** — copy-pasting a block a second time is
  the signal to lift it into the shared home.
- **One canonical home per concept.** Mirror the neighbours: open 1–2 existing siblings (domain query,
  route, locale file, util) and match their structure, naming, and wrappers exactly before adding one.

This is the full guide for [`AGENTS.md`'s Reuse section](../../../AGENTS.md); the **Ripple Map** there
lists what else a change touches. The [`ui-components`](../ui-components/SKILL.md) guide owns the
"reuse the primitive" call in detail.

## Patterns (show, don't tell)

Guard clauses keep the happy path flat:

```ts
// ❌ the main flow is buried three levels deep
function price(cart) {
  if (cart) {
    if (cart.items.length) {
      return sum(cart.items);
    } else {
      return 0;
    }
  }
}
// ✅ handle edges first, then the real work at the left margin
function price(cart) {
  if (!cart || cart.items.length === 0) return 0;
  return sum(cart.items);
}
```

Never swallow an error — handle it or let it propagate:

```ts
// ❌ empty catch hides the failure; the caller can't tell it broke
try {
  await sync();
} catch {}
// ✅ log with context (or re-throw); the failure is observable
try {
  await sync();
} catch (err) {
  console.error('org sync failed', err);
  throw err;
}
```

Extend, don't clone:

```tsx
// ❌ a near-copy of an existing primitive forks its behaviour forever
function DangerButton(props) {
  /* re-implements Button + red styles */
}
// ✅ compose the canonical primitive with a variant — one place to fix
<Button variant="destructive" {...props} />;
```

## See also

[`typescript`](../typescript/SKILL.md) (`as`/`any` ban, Zod boundaries, exports) ·
[`react`](../react/SKILL.md) (component shape, hooks, `useEffect` reflex) ·
[`ui-components`](../ui-components/SKILL.md) (primitive reuse, CVA variants, stories) ·
[`convex`](../convex/SKILL.md) (snake_case files, validators, no tombstones) ·
[`review`](../review/SKILL.md) (the adversarial read that catches missed reuse).
