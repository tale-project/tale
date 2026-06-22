---
name: ui-components
description: How to build UI primitives in packages/ui — Radix composition + CVA + Tailwind v4 + Storybook + accessibility — and the repo-wide styling reference (CVA vs cn(), semantic tokens, motion-reduce, dark/light). Read before building or editing a primitive in packages/ui, choosing CVA vs cn(), adding a Storybook story, writing a checkAccessibility() test, or styling anything with Tailwind. Cross-locale label wording: the translation skill.
---

# ui-components

The contract for shared UI primitives in
[`packages/ui/src/components/`](../../../packages/ui/src/components/) (consumed via `@tale/ui/*`
subpath exports). Compose [Radix](https://www.radix-ui.com/) for behavior, style with
[CVA](https://cva.style) + Tailwind v4, and ship a Storybook story plus an axe test with every
primitive. This file is also the **styling reference** for the whole repo (CVA-vs-`cn()`, tokens,
motion-reduce, dark/light). User-facing wording across locales is the
[`translation`](../translation/SKILL.md) skill; component/hook shape is [`react`](../react/SKILL.md).

## When this applies

Editing or adding anything under `packages/ui/src/components/**`, deciding variants vs. boolean
states, adding a `*.stories.tsx`, writing an `accessibility` test block, or styling with Tailwind
anywhere. Feature-level (non-primitive) UI in `services/platform/app/**` follows the same styling +
skeleton rules but lives next to its feature.

## The rules

- **CVA for NAMED axes, `cn()` for BOOLEAN states.** A finite set (`variant`/`size`/`tone`) is a `cva`
  variant; a true/false condition (`isActive`, `hasError`, `pulse`) is `cn(base, flag && '…')`. Always
  end with `cn(xVariants({ variant }), className)` so a caller's `className` wins (twMerge dedupes).
  `cn` is [`packages/ui/src/lib/cn.ts`](../../../packages/ui/src/lib/cn.ts).
- **Compose Radix; don't reinvent keyboard/focus/aria.** Build overlays, menus, switches, etc. on the
  Radix primitive — it gives focus trapping, roving tabindex, and aria for free. Use real semantic
  HTML (`<button>`, labelled inputs) for the rest.
- **Every primitive ships a Storybook story** (`*.stories.tsx` next to it) covering every
  variant/size/key state — see
  [`badge.stories.tsx`](../../../packages/ui/src/components/feedback/badge.stories.tsx). Stories are
  globbed by [`packages/ui/.storybook/main.ts`](../../../packages/ui/.storybook/main.ts);
  `@storybook/addon-a11y` (configured in
  [`src/storybook/main.ts`](../../../packages/ui/src/storybook/main.ts)) audits each story against
  WCAG 2.1 AA — a red violations bar blocks.
- **Every primitive has an `accessibility` test block calling `checkAccessibility()`** — the
  vitest-axe helper at [`packages/ui/tests/utils/a11y.ts`](../../../packages/ui/tests/utils/a11y.ts)
  (WCAG 2.1 AA: color-contrast, label, button/link-name, image-alt, aria, heading-order). Run with
  `bunx vitest --run --project unit`. Reviewer- and CI-caught.
- **New leaf components are skeleton-aware.** Read `useSkeleton()` or wrap in `<SkeletonBox>` from
  [`@tale/ui/skeleton`](../../../packages/ui/src/components/feedback/skeleton.tsx); inside a
  `<Skeletonize loading>`
  ([`skeleton-context.tsx`](../../../packages/ui/src/components/feedback/skeleton-context.tsx)) the leaf
  masks itself to its natural size — never `if (loading) return <Skeleton>`. Reviewer-caught for
  primitives; pinned for the governance editors by
  [`skeleton-conventions.test.ts`](../../../services/platform/app/features/settings/governance/components/skeleton-conventions.test.ts).
- **Tokens over arbitrary values.** Use semantic Tailwind tokens (`bg-success`,
  `text-muted-foreground`, `border-border`) from
  [`globals.css`](../../../packages/ui/src/globals.css), not `[#hex]` / `h-[37px]` magic dimensions.
  They're theme-aware: dark/light resolves via `resolvedTheme` from
  [`theme-provider.tsx`](../../../packages/ui/src/theme/theme-provider.tsx) (use `dark:` for forks).
- **Motion respects reduced-motion.** Any `animate-*`/`transition` pairs with `motion-reduce:` to
  disable it (e.g. `pulse && 'animate-pulse motion-reduce:animate-none'`).
- **Never a bare `<img>`.** Use the
  [`Image`](../../../packages/ui/src/components/primitives/image.tsx) primitive — it adds an error
  fallback and lazy loading (`priority` opts into eager).
- **No hardcoded user-facing strings** — even in stories/tests. Route through the i18n hook (`useT`);
  wording conventions are the [`translation`](../translation/SKILL.md) skill.

## Composing pages — use the set, don't hand-roll

The rules above build primitives; this builds _pages_ from them. **Feature pages and routes
(`services/platform/app/**`) compose design-system components — they do not emit raw layout HTML.** A
raw `<div className="flex flex-col gap-4">` on a page is the defect this prevents.

- **Layout primitives** ([`@tale/ui/layout`](../../../packages/ui/src/components/layout/layout.tsx)):
  vertical → `Stack`, horizontal → `Row`, responsive grid → `Grid`. They share one `gap` scale and take
  `align`/`justify`/`wrap`, plus an `as` prop for semantic elements (`<Stack as="ul">`,
  `<Stack as="form">`, `<Row as="nav">`) and `asChild` to merge onto a single child. `HStack`/`VStack`
  are **deprecated aliases** of `Row`/`Stack`. A cluster of action buttons is the semantic `ActionRow`;
  a titled section is `PageSection` (or `SettingsSection`). There is **no `Box`** — a neutral wrapper is
  `<Stack gap={0}>`.
- **One spacing scale** — `gapScale` in
  [`layout.tsx`](../../../packages/ui/src/components/layout/layout.tsx). Recommended steps: **`2`** field
  group (label → control → hint), **`4`** within a section (the default), **`6`** loose grouping, **`8`**
  between sections (the settings rhythm). Never a raw `gap-[…]` or `space-y-*` for layout.
- **Button size by context**
  ([`button.tsx`](../../../packages/ui/src/components/primitives/button.tsx)): one height fits all —
  **`default`** (`h-9`) for nearly everything (page/dialog/form/CTA actions) · **`sm`** (`h-8`) ONLY
  for dense bars/toolbars (page-header action bars, table/card-header toolbars, the chat composer,
  filter bars). There is **no `lg`**. Icon-only buttons are the same two heights, square —
  **`icon`** (`size-9`) / **`icon-sm`** (`size-8`); prefer
  [`IconButton`](../../../packages/ui/src/components/primitives/icon-button.tsx) (forces `aria-label`,
  takes the same `size` axis) over a bare `<Button size="icon">`. A `size="icon"` button must hold a
  **single icon** — the square clips text, so an icon+label control uses `default`/`sm` instead.
- **Escape hatch.** Genuinely bespoke layout — chat/canvas, virtualization, geometry-measured
  containers, responsive direction flips (`flex-col sm:flex-row`) — may stay raw with a one-line
  `// raw layout: <reason>` so it reads as deliberate, not an oversight.

## Concept → component catalog

One concept, one component. Find it here before writing layout markup; import via `@tale/ui/<subpath>`
unless noted.

| Concept                 | Component                           | Concept                     | Component                  |
| ----------------------- | ----------------------------------- | --------------------------- | -------------------------- |
| Vertical group          | `Stack`                             | Horizontal group            | `Row`                      |
| Responsive grid         | `Grid`                              | Action-button cluster       | `ActionRow`                |
| Center content          | `Center`                            | Flex spacer                 | `Spacer`                   |
| Page-width wrapper      | `Container` / `NarrowContainer`     | Titled section              | `PageSection`              |
| Settings page / section | `SettingsPage` / `SettingsSection`¹ | Section header              | `SectionHeader`            |
| Card                    | `Card`                              | Bordered subsection         | `BorderedSection`          |
| Heading (h1–h6)         | `Heading`                           | Body / muted / label text   | `Text`                     |
| Button / link-button    | `Button` / `LinkButton`             | Icon-only button            | `IconButton`               |
| Text / multiline input  | `Input` / `Textarea`                | Field (label+control+error) | `Field`                    |
| Select / searchable     | `Select` / `SearchableSelect`²      | Toggle                      | `Switch`²                  |
| Checkbox                | `Checkbox`                          | Slider                      | `Slider`                   |
| List / table            | `DataTable` (+ `useListPage`)¹      | Empty state                 | `EmptyState`               |
| Badge / status dot      | `Badge` / `StatusIndicator`         | Alert / callout             | `Alert`                    |
| Dialog / sheet          | `ResponsiveDialog`                  | Popover / menu              | `Popover` / `DropdownMenu` |
| Tooltip                 | `Tooltip`                           | Tabs                        | `Tabs`                     |
| Stat / stat group       | `StatItem` / `StatGrid`             | Code (inline / block)       | `InlineCode` / `CodeBlock` |
| Image                   | `Image`                             | Loading                     | `Skeletonize` / `Spinner`  |

¹ App-level (not `@tale/ui`): `SettingsPage`/`SettingsSection`, `DataTable`, `useListPage` live under
`services/platform/app/components/` — import from `@/app/...`. ² `Select`, `SearchableSelect`, `Switch`,
`RadioGroup` live in `app/components/ui/forms/` (app-level canonical — no `@tale/ui` rival); promote to
`@tale/ui` only when a non-platform workspace (`web`/`docs`) needs them.

Missing a concept? Extend the closest primitive or add a new one in `packages/ui` (story + a11y +
skeleton-aware) — never a one-off in a feature folder.

## One implementation per concept — the `@tale/ui` ↔ app layering

There are two component layers, and **the same concept must never be implemented twice.** The split:

- **`@tale/ui` owns the bare, shared primitive** (the control + its styling, once). It is consumed by
  every workspace — `web` and `docs` included — and those **cannot import** `services/platform` code.
  So any primitive a non-platform surface needs lives in `@tale/ui`, never in the app.
- **The platform app composes that primitive; it never re-implements its styling.** The app layer adds
  platform-only UX (label/description/error, password toggle, skeleton, i18n) _around_ the `@tale/ui`
  control. Reference pattern:
  [`app/.../data-display/image.tsx`](../../../services/platform/app/components/ui/data-display/image.tsx)
  wraps `@tale/ui/image` and only adds the `BASE_PATH` fallback.

**Rule:** before building a control under `app/components/ui/`, find the `@tale/ui` primitive and
**compose it**. A second, divergent implementation (its own CVA/styling for an input, checkbox,
tooltip, …) is a defect — it drifts. One canonical per concept.

**Canonical per cross-layer concept** (use these; never fork a rival):

| Concept                          | Canonical (use this)                          | Composes                                                  |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Text input / textarea / checkbox | app `forms/{input,textarea,checkbox}`         | `@tale/ui/{input,textarea,checkbox}` (bare control)       |
| Label                            | app `forms/label` (required/info/error)       | `@tale/ui/label`                                          |
| Tooltip (simple)                 | app `overlays/tooltip` (`content`+`children`) | `@tale/ui/tooltip` (`TooltipContent`; raw parts for adv.) |
| Settings section                 | app `SettingsSection`                         | `@tale/ui/page-section`                                   |
| Image                            | app `data-display/image`                      | `@tale/ui/image`                                          |
| Pagination                       | `data-table/data-table-pagination`            | — (standalone `navigation/pagination` was dead, removed)  |

**Genuinely distinct — do NOT merge** (similar names, different concepts): `StatCard`/`StatCardGrid`
(bordered headline-metric strip) vs `StatItem`/`StatGrid` (borderless `<dl>` key/value); `EmptyState`
(full-height) vs `EmptyPlaceholder` (inline dashed); `@tale/ui/Field` (form wrapper) vs app `Field`
(read-only display); the `Dialog → ConfirmDialog → DeleteDialog` / `FormDialog` / `ViewDialog`
composition ladder; `InlineCode` vs `CodeBlock`; `Popover` (interactive) vs `Tooltip` (passive).

**Known styling drift to reconcile** (the app control re-implements the primitive's look instead of
composing it — route it through the `@tale/ui` primitive, reconcile to one token set, verify visually):
`forms/input`, `forms/textarea`, `forms/checkbox` (border/focus tokens), `overlays/tooltip` (content
background). Until reconciled, use the canonical above — don't add a third.

## When to create a new primitive

Reuse → extend (add a `variant`/prop) → compose → only then create. A new shared primitive lives in
`packages/ui/src/components/<category>/`, ships a `*.stories.tsx` (all variants) and a
`checkAccessibility()` block, is skeleton-aware if it's a leaf, and gets a `@tale/ui/<name>` subpath
export.

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

The mandatory axe block
([`badge.test.tsx`](../../../packages/ui/src/components/feedback/badge.test.tsx)):

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
