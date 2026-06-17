---
name: typescript
description: TypeScript conventions for the Tale monorepo — the no-`any` toolkit (type guards, generics, discriminated unions, exhaustive `never`), union types over enums, `readonly`/`as const`/`satisfies`, named-exports-only, and Zod boundary validation. Read before writing TypeScript — reaching for `as`/`any`/`unknown`, designing a type, choosing exports, or validating input with Zod.
---

# typescript

How TypeScript is written across the Tale monorepo (services + packages). The compiler is the
floor; the rules below are what review and lint add on top. Convex backend code has extra rules
(snake_case files, `convex/values` validators instead of Zod) — see [`convex`](../convex/SKILL.md).
Naming/structure smells beyond types live in [`clean-code`](../clean-code/SKILL.md); component-side
conventions in [`react`](../react/SKILL.md).

## When this applies

**Every** `.ts`/`.tsx` file in the repo — feature code, hooks, lib utilities, shared schemas,
package source, **and Convex functions**. These rules hold everywhere; Convex doesn't opt out of
them, it only _adds_ its own (snake_case filenames, `convex/values` `v` for `args`/`returns` instead
of Zod — see [`convex`](../convex/SKILL.md)). The moment you reach for `as`, `any`, `!`, `enum`, a
`default export`, or you're parsing input from the network/files/forms — stop and read the matching
rule.

## The rules

The compiler runs `strict`, `isolatedModules`, `noEmit` ([`tsconfig.base.json`](../../../tsconfig.base.json)),
and oxlint ([`.oxlintrc.json`](../../../.oxlintrc.json)) gates the rest:

- **No `any`.** `typescript/no-explicit-any` is `error`. `any` disables every check downstream. Use a
  type guard, a generic with a constraint, a discriminated union, or `unknown` + narrowing — never
  `any`. `as` is a last resort and must be reviewer-justified; an unsafe cast is a silent bug.
- **No non-null `!`.** `typescript/no-non-null-assertion` is `error`. `x!` asserts a lie the compiler
  can't check. Narrow with `if (!x) return` / early-throw, or model the absence in the type.
- **`@ts-expect-error` only, with a ≥10-char reason; never `@ts-ignore`/`@ts-nocheck`.** Enforced by
  `typescript/ban-ts-comment` — the description must explain _why_ the line is unsound so review can
  judge it.
- **Lean on inference; annotate the boundary.** Don't restate what's obvious (`const n = 0`); do
  annotate exported function signatures and public APIs so callers get a stable contract and errors
  surface at the definition, not the call site.
- **Exhaustive over open.** Model variants as a **discriminated union** and close `switch`es with a
  `never` default — adding a variant then becomes a compile error, not a runtime surprise.
- **Union types over `enum`.** Prefer `type X = 'a' | 'b'` (often from an `as const` array). Enums emit
  runtime objects, don't narrow from strings, and play badly with `isolatedModules`.
- **`readonly` / `as const` by default.** Freeze literal arrays and config with `as const`; mark fields
  `readonly` unless mutation is intended. Immutability is the cheapest correctness guarantee.
- **`satisfies` for config objects.** Validate an object against a type _without_ widening it, so keys
  stay literal — `{ … } satisfies PasswordPolicyConfig`, not `: PasswordPolicyConfig`.
- **`async`/`await`, not `.then`.** One control-flow style; await reads top-to-bottom and keeps stacks.
- **Named exports only.** Default exports resist rename, break `grep`, and let each importer pick a
  different name. Imports at the top, exports at the bottom; export only what's used; avoid barrel
  (`index.ts` re-export) files — they hide the real module and bloat the graph.

## Patterns

`as any` cast → discriminated union with an exhaustive `never` (the compiler now enforces coverage):

```ts
// ❌ cast lies; a new kind silently falls through
const label =
  (event as any).kind === 'sms' ? event.phone : (event as any).email;

// ✅ union + never: adding a variant is a compile error here
type Notice =
  | { kind: 'sms'; phone: string }
  | { kind: 'email'; address: string };
function label(n: Notice): string {
  switch (n.kind) {
    case 'sms':
      return n.phone;
    case 'email':
      return n.address;
    default: {
      const _exhaustive: never = n;
      return _exhaustive;
    }
  }
}
```

`enum` → `as const` union (no runtime object, narrows from strings):

```ts
// ❌ enum DataSource { Stripe = 'stripe', Shopify = 'shopify' }
// ✅ — see services/platform/lib/shared/schemas/common.ts
const dataSourceLiterals = ['stripe', 'shopify', 'webhook'] as const;
export type DataSource = (typeof dataSourceLiterals)[number]; // 'stripe' | 'shopify' | 'webhook'
```

## Zod: validate at every boundary

Untrusted input (HTTP bodies, file/JSON config, form data, external API responses) is parsed with
**Zod** before it's trusted. Shared schemas live in
[`services/platform/lib/shared/schemas/`](../../../services/platform/lib/shared/schemas/) (note:
`schemas/`, _not_ `validators/`) and import from **`'zod/v4'`** — match the existing files exactly.

- **Infer types from schemas; never hand-write a parallel `interface`.** `z.infer<typeof schema>` keeps
  the runtime check and the static type in lockstep — one source of truth.
- **`.parse()` at the edge, typed value inward.** Once parsed, downstream code works with the inferred
  type and needs no re-validation.
- **Convex functions don't use Zod** — they validate `args`/`returns` with `convex/values` `v`. See
  [`convex`](../convex/SKILL.md). Zod is for everything else.

```ts
// services/platform/lib/shared/schemas/common.ts (shape)
import { z } from 'zod/v4';
const dataSourceSchema = z.enum(['stripe', 'shopify', 'webhook']);
export type DataSource = z.infer<typeof dataSourceSchema>; // ← derive, don't duplicate
```

## Verify

`bun run lint --workspace=@tale/platform` (oxlint) catches `any`/`!`/banned comments; `tsc --noEmit`
catches the rest. Both must be clean before you call a change done — see
[`definition-of-done`](../definition-of-done/SKILL.md) and [`verify`](../verify/SKILL.md).
