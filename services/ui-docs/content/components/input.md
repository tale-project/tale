---
title: Input
description: The text field — its label, description, hint and error slots, and the states you get without writing any markup.
---

`Input` is a field, not a bare `<input>`. It renders its own label,
description, hint and error through `FieldShell`, with the ids connected, so a
form written with it is labelled correctly by construction.

By the end of this page you will know which slot each piece of copy belongs in,
how the states differ, and when the raw element is the right call instead.

```tsx
import { Input } from '@tale/ui/input';
```

## A labelled field

<Demo name="input/basic" />

Four text slots, each with a job:

- **`label`** — the field's name. Always present, always `text-foreground`.
- **`description`** — one sentence under the label, explaining what the value
  does. Shown before the reader types.
- **`hint`** — a note under the control, for a rule that only makes sense once
  you have seen the field.
- **`errorMessage`** — inline validation, paired with `isInvalid`.

## States

<Demo name="input/states" />

**`passwordToggle`** adds a show/hide control to a `type="password"` field.
**`sensitive`** marks the value as a secret — it suppresses the browser's save-
password prompt and password-manager autofill, so an API key never lands in the
credential store. A `type="password"` field is treated as sensitive
automatically.

**`isInvalid` with `errorMessage`** renders the error and wires `aria-invalid`.
Pass both: the colour alone is not a message, and the message alone is not a
state.

**`disabledReason`** works exactly as it does on
[Button](/docs/components/button) — the field stays focusable and becomes
`readOnly` with `aria-disabled`, so the tooltip explaining why can reach a
keyboard reader. It applies only while `disabled` is true.

**`variant="readOnly"`** is for a value the reader may not edit in this
context. It keeps the field's exact footprint — the same `h-9`, the same
padding — and drops only the ring and the fill, so toggling editable and
read-only causes no layout shift.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | `string` | — | The field's name |
| `description` | `ReactNode` | — | Sentence under the label |
| `hint` | `ReactNode` | — | Note under the control |
| `errorMessage` | `string` | — | Inline validation message |
| `isInvalid` | `boolean` | `false` | Error state; wires `aria-invalid` |
| `variant` | `'default' \| 'unstyled' \| 'readOnly'` | `'default'` | |
| `passwordToggle` | `boolean` | `false` | Show/hide control for a password |
| `sensitive` | `boolean` | `false` | Suppress autofill and the save prompt |
| `disabledReason` | `ReactNode` | — | Why the field is disabled |
| `wrapperClassName` | `string` | — | Classes on the `FieldShell` frame |

Every remaining `<input>` attribute passes through, except `size` and `prefix`,
which the component reserves.

## Layout

The field is stacked by default — label, control, hint. Inside a container
that declares the **row layout** it becomes two columns from `sm` up, with the
label on the left and the control pinned to a fixed 20rem column.

You never set that per field. `ContentArea variant="narrow"` declares it for
the whole page, which is how every control on a settings screen lines up. See
the [settings page pattern](/docs/patterns/settings-page).

## Accessibility

- The label is a real `<label for>`; the description and error are connected
  through `aria-describedby`.
- Error text is `text-destructive` **and** carries `aria-invalid` on the
  control. Colour is never the only signal.
- The field's border is `border-border-input`, which is stronger than the
  default border in light mode — the plain one measures about 1.2:1 on white,
  which is not a visible shape.
- Focus is the shared ring, on `focus-visible`.

## When to use something else

| Instead of | Use |
| --- | --- |
| Multi-line text | `Textarea` |
| A fixed set of options | `Select`, or `RadioGroup` for three or fewer |
| A searchable set | `SearchableSelect` |
| JSON or config text | `JsonInput` |
| A value the reader copies | `CopyableField` |
| A table's filter box | `DataTable`'s `search` prop |

## Where to go next

[Data table](/docs/components/data-table) is where most of these fields end up
pointing — it is the surface a list page is built around.
