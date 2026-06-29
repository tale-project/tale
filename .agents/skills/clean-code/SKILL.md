---
name: clean-code
description: The language-agnostic baseline for every line in Tale — intention-revealing names, small single-purpose functions, guard clauses, comments that explain why, fail-fast errors, immutability, and the reuse-and-centralization procedure (search packages/ui → shared app/lib → feature before creating anything). Read before writing or changing code in any language — naming, function shape, error handling, comments, and whether to reuse instead of write new. Syntax lives in typescript / react / ui-components / convex.
---

# clean-code

The language-agnostic baseline for every line written in this repo, and the canonical home for the
**reuse and centralization** procedure that [`AGENTS.md`](../../../AGENTS.md) summarizes. The
per-language guides own the syntax — [`typescript`](../typescript/SKILL.md),
[`react`](../react/SKILL.md), [`ui-components`](../ui-components/SKILL.md),
[`convex`](../convex/SKILL.md) — and a language guide wins where it sharpens a rule here (e.g.
snake_case filenames in Convex).

## When this applies

Before you write or change code in any workspace, in any language — especially before you _create_ a
component, hook, util, type, validator, or constant, since the cheapest reuse miss to catch is the
one you haven't made yet. For a specific stack's syntax, read its guide; come here for naming,
function shape, error handling, comments, and the reuse decision.

## The rules

- **Intention-revealing names; no abbreviations.** `activeMemberships`, not `am`/`data`/`tmp`. One
  word per concept across the codebase (don't mix `fetch`/`get`/`load` for the same idea) — a
  consistent vocabulary is what lets grep and the next reader find things.
- **Small, single-purpose functions.** One job, one level of abstraction. If you need "and" to
  describe it, split it. Smaller units are testable and reusable — the function is the unit of reuse.
- **Guard clauses over deep nesting.** Return early on the error/edge case; keep the happy path flat
  at the left margin. Deep `if`/`else` pyramids bury the main flow.
- **Command/query separation.** A function either _does_ something or _answers_ something, never
  both. A getter that mutates traps every caller.
- **Few or no flag arguments.** A boolean param that switches behaviour is two functions wearing one
  name — split them so the call site reads true.
- **Named constants, no magic values.** A bare `3600` or `'pending'` hides intent; name it
  (`SESSION_TTL_SECONDS`). The name is the documentation, and there's one place to change it.
- **Comments explain _why_, not _what_.** Reserve them for intent, trade-offs, and non-obvious
  constraints. **No status comments** (`// REFACTORED`, `// TODO #123`) and **no commented-out
  code** — git is the record ([`AGENTS.md` code style](../../../AGENTS.md)). Reviewer-caught.
- **Fail fast at boundaries; never swallow errors.** Validate input where it enters the system; throw
  typed/structured errors close to the cause. **No empty catch** — log
  (`console.warn`/`console.error`) or re-throw (code-style rule); a silent catch hides the bug.
  User-facing errors say _what_ went wrong _and how_ to recover.
- **Prefer immutability and pure functions.** Default to `const`; compute new values rather than
  mutating shared state. Shared mutable state is where race conditions and spooky action live.
- **Rule of three before abstracting.** A little duplication is cheaper than the wrong abstraction.
  Extract a helper on the _second_ real use; generalize at the third. But this grace is for internal
  helpers only — a user-facing surface or a sibling capability reuses from the _first_; see Reuse.
- **One concept per file; named exports, no barrels.** Things that change together live together.
  Filenames are **dash-case** (snake_case in Convex); default exports resist renaming and break grep.
- **Delete dead code.** `knip` flags unused exports — and an unused symbol is usually the _symptom of
  a missed reuse_. Remove it rather than leaving it to rot. Enforced by `knip`.

## Reuse and centralization (the canonical procedure)

Architecture drifts when agents write new instead of looking first. The cheap miss is a duplicated
helper — three near-identical buttons, four date formatters. The expensive one is the **second
implementation of a whole concept**: two catalog pages that share no code, two list layouts in
different shapes, agents and workflows driving tasks through two divergent ability sets. Each is a
defect — a fix in one copy never reaches the others, and users learn two ways to do one thing.

**One concept, one name, one implementation.** Before creating **any** component, hook, util, type,
validator, constant, route, page, or capability — and before building anything that _resembles_
something the app already does — walk this order and stop at the first hit:

1. **Name the concept and search for it by vocabulary, not just by symbol.** A grep for `CardGrid`
   that misses an existing `Catalog` is how duplicates are born. Search the words a user or dev would
   use (catalog, list, picker, folder tree, ability) and open the closest analogous feature.
2. **Design system** — [`packages/ui`](../../../packages/ui/) (Button, Input, Badge, Dialog,
   Skeletonize, …). A UI need almost always already has a primitive.
3. **Shared app/lib code** — top-level [`app/`](../../../services/platform/app/)
   (`components`/`hooks`/`lib`) for frontend; [`convex/lib/`](../../../services/platform/convex/lib/)
   and [`lib/shared/`](../../../services/platform/lib/shared/) for backend.
4. **The feature** — a sibling to extend, and the analogous feature to mirror.
5. Only if nothing fits, **create — in its canonical home, once, under a name the next agent will search for.**

- **Reuse or generalize the first; never fork a second.** Building the second catalog, list page, or
  capability surface? The shared concept _is_ the deliverable — extract or extend the first so both
  use it. For anything a user sees or a sibling system calls, the second divergent copy is wrong on
  sight; the rule of three is for internal helpers only, not user-facing surfaces.
- **Compose or extend, don't clone.** Add a `variant`/prop or compose the primitive; never duplicate
  its role. A clone forks behaviour — a bug fixed in one copy stays alive in the others.
- **New shared primitive → `packages/ui`, with a Storybook story** (all variants + a11y), never a
  one-off in a feature folder.
- **One canonical home per concept; mirror the neighbours exactly.** Open 1–2 existing siblings
  (domain query, route, locale file, util, page) and match their structure, naming, order, and
  wrappers before adding one. Diverge only when you can say why.

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
[`convex`](../convex/SKILL.md) (snake_case files, validators) ·
[`review`](../review/SKILL.md) (the adversarial read that catches missed reuse).
