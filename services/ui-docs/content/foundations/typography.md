---
title: Typography
description: Choose text styles without confusing visual size with the page's semantic heading structure.
---

Use `Heading` for section headings and `Text` for common body, label, caption, and feedback styles. Select the HTML element from the content's role, then choose its visual size. A small heading remains a heading; large text is not automatically a page title.

## Compare the text scale

<Demo name="foundations/type-scale" />

Inspect the headings and supporting text in both themes. Use ordinary body text for instructions someone needs to read, and reserve captions for secondary metadata rather than shrinking important information to fit.

## Choose the heading level separately

```tsx
import { Heading } from '@tale/ui/heading';

export function MemberSectionTitle() {
  return <Heading level={2} size="lg">Members</Heading>;
}
```

| Prop | Values | Default |
| --- | --- | --- |
| `level` | `1` through `6`; selects the heading element. | `2` |
| `size` | `xs`, `sm`, `base`, `lg`, `xl`, `2xl` | `base` |
| `weight` | `medium`, `semibold`, `bold` | `semibold` |
| `tracking` | `tighter`, `tight`, `normal` | Unset |
| `truncate` | Adds an ellipsis and allows a flex child to shrink. | `false` |

Use one accessible `h1` for the page. In an application layout, the header title or breadcrumb leaf usually supplies it, so body sections begin at `h2`. A settings rail label is navigation, not a replacement for the heading.

`CardTitle` renders an `h3`. Use it under an `h2` section; if that is the wrong depth, choose an explicit `Heading` inside the card instead of accepting a skipped level.

## Pick a text variant

```tsx
import { Text } from '@tale/ui/text';

export function DigestDescription() {
  return <Text variant="muted">Send a weekly summary to the selected members.</Text>;
}
```

| Variant | Treatment |
| --- | --- |
| `body` (default) | Primary text, `text-sm`. |
| `body-sm` | Primary text, `text-xs`. |
| `muted` | Supporting text, `text-sm`. |
| `caption` | Supporting metadata, `text-xs`. |
| `label`, `label-sm` | Medium-weight primary text, at small or extra-small size. |
| `code` | Monospace, `text-xs`. |
| `error`, `error-sm` | Destructive-color feedback, at small or extra-small size. |
| `success` | Medium-weight success feedback, `text-sm`. |

`Text` defaults to a paragraph. Its `as` prop accepts `p`, `span`, `div`, `label`, or `h3`; `align` accepts `left`, `center`, or `right`. Changing to `label` does not associate the text with a control by itself: use a form component's label API or provide a valid association.

Use truncation for compact navigation or metadata only when the full content remains discoverable. Avoid truncating instructions, errors, or the only meaningful name of a record.

## Load the intended font

`AppShell` imports Inter at weights 400, 500, 600, and 700 from the shared `fonts.ts` module. The font assets are self-hosted through the application build. Latin weights 400 and 500 are preloaded; a metric-adjusted Arial fallback reduces layout movement while the font loads.

Preloading reduces delay but does not guarantee that a fallback is never visible. If text uses the fallback after loading, inspect the emitted font requests and confirm the app entry mounts `AppShell`. Do not add an unrelated remote font import to hide a broken asset path.

Monospace uses the system stack: `ui-monospace`, SFMono-Regular, Menlo, Monaco, Consolas, then monospace.

## Use the marketing scale on public pages

`@tale/marketing-ui/section-heading` uses the same typeface with larger, normal-weight display styles. Its display size defaults to `h1`; section and subsection sizes default to `h2`. Choose the semantic `as` level explicitly when nesting it. See [Marketing UI](/docs/marketing-ui/overview) for the surrounding layout.
