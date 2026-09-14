---
title: Spacing and layout
description: Align controls, choose shared containers, and keep content usable when the available width changes.
---

Build layout from the shared spacing scale and containers. Consistent control heights and section gaps make related fields and actions easier to scan; responsive behavior still depends on how the full page is composed.

## Align ordinary controls

<Demo name="foundations/control-heights" />

The ordinary app control height is 36px (`h-9`). Buttons also offer a 32px (`h-8`) dense variant; their icon-sized counterparts are square. Input has no size axis. Match neighboring controls through these APIs rather than assigning individual pixel heights.

The primary app header row is 52px (`h-13`). Other primitives, such as text-style link buttons and multiline fields, have different footprints. Do not force a multiline control into the single-line height.

## Use a deliberate gap scale

```tsx
import { Grid, Row, Stack } from '@tale/ui/layout';

export function SectionLayout() {
  return (
    <Stack as="section" gap={8}>
      <Row gap={2} wrap>{/* Related actions */}</Row>
      <Grid cols={1} md={2} gap={4}>{/* Two responsive groups */}</Grid>
    </Stack>
  );
}
```

| Gap | Typical use |
| --- | --- |
| `2` | Tightly related items or field content. |
| `4` | Items within a section; the layout primitives' default. |
| `6` | A more open group. |
| `8` | Separation between sections. |

The full scale is `0`, `1`, `2`, `3`, `4`, `5`, `6`, `8`, `10`, `12`. Prefer the recommended steps for new app layouts; `5`, `10`, and `12` remain for existing compositions. `Stack`, `Row`, and `Grid` accept a semantic `as` element or `asChild` for one child. Choose one, rather than combining them.

`Row` does not wrap by default. Enable `wrap` for action groups that should form another line; give flexible text children `min-w-0` where truncation or wrapping must work. `Grid` accepts `sm`, `md`, `lg`, and `xl` column overrides.

## Choose the content measure

| Container | Use |
| --- | --- |
| `ContentArea` with `page` | Normal application content; shared padding and gaps. |
| `ContentArea` with `narrow` | Centered configuration column, capped at `max-w-3xl`, with settings field layout. |
| `ContentArea` with `panel` | Content inside a secondary panel. |
| `NarrowContainer` | A centered form column capped at 544px. |
| `Container` | Generic width-constrained content, with `md`, `lg`, `xl`, or `full` sizing. |

`ContentArea` defaults to `page` and `gap={6}`. Its narrow variant also declares the `FieldShell` row layout: stacked labels on small screens and a shared control column from `sm`. It includes bottom clearance for mobile floating actions; avoid replacing that clearance with ad hoc padding.

## Use Card for a bordered object

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@tale/ui/card';

export function MemberCard() {
  return (
    <Card padding="md" className="space-y-4">
      <CardHeader><CardTitle>Members</CardTitle></CardHeader>
      <CardContent>Three members have access.</CardContent>
    </Card>
  );
}
```

This example assumes the card sits under an `h2` section because `CardTitle` is an `h3`. Card owns its padding; the header and content slots do not add their own padding.

| Option | Values and default |
| --- | --- |
| `padding` | `none`, `sm` (12px), `md` (16px), `lg` (20px), `xl` (24px); default `xl`. |
| `radius` | `lg` (normally 8px) or `xl` (16px); default `lg`. |
| `shadow` | `none`, `sm`, `md`; default `none`. |
| `interactive` | Hover/focus styling; default `false`. |
| `asChild` | Merge the frame onto one child element; default `false`. |

`interactive` does not turn a `div` into a keyboard-operable control. For a linked or clickable card, compose it onto a real anchor, router link, or button with `asChild` and an appropriate name.

The shared radius tokens are `rounded-sm` 6px, `rounded-md` 8px, `rounded-lg` from the normal 8px radius variable, and `rounded-xl` 16px. Prefer component variants over rebuilding their edge and fill styles manually.

## Check the whole layout

Test a long title, longer translated labels, an open side panel, and a phone width. Keep wide tables and code scrollable inside their containers rather than forcing the entire page sideways. Check that fixed actions leave the final field reachable. Use [App shell](/docs/components/app-shell) for page composition and [Settings page](/docs/patterns/settings-page) for draft/save behavior.
