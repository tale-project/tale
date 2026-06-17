---
name: ui-components
description: How to build UI primitives in packages/ui — Radix composition + CVA + Tailwind v4 + Storybook + accessibility — and the styling reference (CVA vs cn(), tokens, motion-reduce, dark/light). Read before building or editing a primitive in packages/ui, choosing CVA vs cn(), adding a Storybook story, writing a checkAccessibility() test, or styling anything with Tailwind. Cross-locale label rules: the translation skill.
---

# ui-components

The contract for shared UI primitives in [`packages/ui/src/components/`](../../../packages/ui/src/components/)
(consumed via `@tale/ui/*` subpath exports). Compose [Radix](https://www.radix-ui.com/) for
behavior, style with [CVA](https://cva.style) + Tailwind v4, ship a Storybook story and an axe test
with every primitive. User-facing strings go through the i18n hook — cross-locale wording lives in
the [`translation`](../translation/SKILL.md) skill. This file is also the **styling reference** for
the whole repo (CVA-vs-`cn()`, tokens, motion-reduce, dark/light).

## When this applies

Editing or adding anything under `packages/ui/src/components/**`, deciding how to express variants
vs. boolean states, adding a `*.stories.tsx`, writing an `accessibility` test block, or styling with
Tailwind anywhere. Feature-level (non-primitive) UI in `services/platform/app/**` follows the same
styling + skeleton rules but lives next to its feature.

## The rules

- **CVA for NAMED axes, `cn()` for BOOLEAN states.** A finite set (`variant`/`size`/`tone`) is a
  `cva` variant; a true/false condition (`isActive`, `hasError`, `pulse`) is `cn(base, flag && '…')`.
  Always end with `cn(xVariants({ variant }), className)` so a caller's `className` wins (twMerge
  dedupes). `cn` is [`packages/ui/src/lib/cn.ts`](../../../packages/ui/src/lib/cn.ts).
- **Compose Radix; don't reinvent keyboard/focus/aria.** Build overlays, menus, switches, etc. on the
  Radix primitive — it gives focus trapping, roving tabindex, and aria for free. Real semantic HTML
  (`<button>`, labelled inputs) for the rest.
- **Every primitive ships a Storybook story** (`*.stories.tsx` next to it) covering every
  variant/size/key state — see [`badge.stories.tsx`](../../../packages/ui/src/components/feedback/badge.stories.tsx).
  Stories are globbed by [`packages/ui/.storybook/main.ts`](../../../packages/ui/.storybook/main.ts);
  `@storybook/addon-a11y` (configured in [`src/storybook/main.ts`](../../../packages/ui/src/storybook/main.ts))
  audits each story against WCAG 2.1 AA — a red violations bar blocks.
- **Every primitive has an `accessibility` test block calling `checkAccessibility()`** — the
  vitest-axe helper at [`tests/utils/a11y.ts`](../../../packages/ui/tests/utils/a11y.ts) (WCAG 2.1
  AA: color-contrast, label, button/link-name, image-alt, aria, heading-order). Run with
  `bunx vitest --run --project unit`. Reviewer- and CI-caught.
- **New leaf components are skeleton-aware.** Read `useSkeleton()` or wrap in `<SkeletonBox>` from
  [`@tale/ui/skeleton`](../../../packages/ui/src/components/feedback/skeleton.tsx); inside a
  `<Skeletonize loading>` ([`skeleton-context.tsx`](../../../packages/ui/src/components/feedback/skeleton-context.tsx))
  the leaf masks itself to its natural size — never `if (loading) return <Skeleton>`. Enforced by
  `governance/components/skeleton-conventions.test.ts`.
- **Tokens over arbitrary values.** Use semantic Tailwind tokens (`bg-success`, `text-muted-foreground`,
  `border-border`) defined in [`globals.css`](../../../packages/ui/src/globals.css), not `[#hex]` /
  `h-[37px]` magic dimensions. They're theme-aware: dark/light resolves via `resolvedTheme` from
  [`theme-provider.tsx`](../../../packages/ui/src/theme/theme-provider.tsx) (use `dark:` for forks).
- **Motion respects reduced-motion.** Any `animate-*`/`transition` pairs with `motion-reduce:` to
  disable it (e.g. `pulse && 'animate-pulse motion-reduce:animate-none'`).
- **Never a bare `<img>`.** Use the [`Image`](../../../packages/ui/src/components/primitives/image.tsx)
  primitive — it adds an error fallback and lazy loading (`priority` opts into eager).
- **No hardcoded user-facing strings** — even in stories/tests. Route through the i18n hook
  (`useT`); wording conventions are the [`translation`](../translation/SKILL.md) skill.

## Patterns (show, don't tell)

CVA base + named `variant`, then `cn(...)` so `className` overrides
([`badge.tsx`](../../../packages/ui/src/components/feedback/badge.tsx)):

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva('inline-flex items-center rounded-md text-xs', {
  variants: {
    variant: {
      outline: 'border border-border',
      green: 'bg-green-100 text-green-800',
    },
  },
  defaultVariants: { variant: 'outline' },
});

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
```

Boolean state via `cn()`, not a CVA axis — and reduced-motion-safe
([`status-indicator.tsx`](../../../packages/ui/src/components/feedback/status-indicator.tsx)):

```tsx
<div
  className={cn(
    statusDotVariants({ variant, size }),
    pulse && 'animate-pulse motion-reduce:animate-none',
  )}
  aria-hidden="true"
/>
```

The mandatory axe block ([`badge.test.tsx`](../../../packages/ui/src/components/feedback/badge.test.tsx)):

```tsx
describe('accessibility', () => {
  it('passes axe audit', async () => {
    const { container } = render(<Badge>Badge</Badge>);
    await checkAccessibility(container); // throws on any WCAG 2.1 AA violation
  });
});
```

## Verify UI changes

Run `bunx vitest --run --project unit` for the axe + render tests, and open Storybook
(`bun run --filter @tale/ui storybook`) to eyeball every variant with the a11y addon — a red bar is a
blocker, not a warning.
