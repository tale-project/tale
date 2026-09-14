---
title: Icons
description: Lucide only, four sizes, and the naming rule that keeps an icon-only button usable.
---

Icons come from one set. A custom SVG in a component is a fork of the visual
language that nobody will maintain, so the system ships the handful of marks
Lucide does not have and otherwise takes what Lucide gives.

By the end of this page you will know the sizes, the stroke, and the one rule
that decides whether an icon needs a name.

## The set and the sizes

<Demo name="foundations/icons" />

`lucide-react` is the icon set. Lucide's default stroke width is used
unmodified — there is no global override, and a component that sets its own
`strokeWidth` is deviating on purpose.

| Class | Use it for |
| --- | --- |
| `size-3` | Inline with 11–12px text |
| `size-4` | The default. Button icons, row icons, most chrome |
| `size-5` | A standalone control that needs presence |
| `size-6` | A feature or empty-state glyph |

`Button` hardcodes `size-4` for its leading icon. `IconButton` takes an
`iconSize` of `3 | 4 | 5 | 6` and defaults to `4`.

## The marks Lucide does not ship

`lucide-react` v1 dropped brand icons, so the package ships its own with the
same `forwardRef` + `LucideProps` shape — they drop straight into any
`icon: LucideIcon` slot:

```tsx
import { GithubIcon } from '@tale/ui/icons/github';

<IconButton icon={GithubIcon} aria-label="Source on GitHub" />;
```

Alongside GitHub there are `claude-icon`, `google-icon`, `microsoft-icon`,
`gmail-icon`, `google-drive-icon`, `onedrive-icon`, `outlook-icon`,
`sharepoint-icon`, `shopify-icon`, `website-icon`, `enter-key-icon` and the
locale flags. Each has its own `@tale/ui/icons/<name>` subpath.

Anything outside that list is a Lucide glyph or it is a defect.

## Name it, or hide it

An icon is either decoration beside a label, or it **is** the control. The two
cases have opposite requirements.

**Decoration** — the label already names the thing, so the icon is hidden:

```tsx
<Button icon={Download}>Export</Button>
// Button sets aria-hidden="true" on the icon for you
```

**The control itself** — the icon carries the whole meaning, so it needs a
name:

```tsx
<IconButton icon={Search} aria-label="Search" />
```

`IconButton` requires `aria-label` at the type level, so this cannot be
forgotten. `Button` enforces the same thing as a union: an icon-only size is
only valid when the button also carries `aria-label` or `title`.

> [!WARNING]
> A tooltip is a **description, not a name**. The shared `Tooltip` wires its
> content through `aria-describedby`, so a button named only by its tooltip is
> announced as "button" with a trailing description — a WCAG 4.1.2 failure.
> Set `aria-label` (or `title`, which populates both) and let the tooltip add
> detail on top.

`title` is the one-stop prop for an icon button: a plain string populates both
the accessible name and the hover tooltip, and the native browser tooltip is
suppressed so there is no duplicate.

## Hit targets

Anything clickable is at least 24×24 CSS pixels (WCAG 2.5.5). Both icon-button
sizes clear that — `size-9` is 36px, `size-8` is 32px — and the mobile header
pads its slots to 44px.

## Where to go next

[Accessibility](/docs/foundations/accessibility) collects the rest of the
rules, including the ones that are easy to break without noticing.
