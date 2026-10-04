---
title: Input
description: Build labelled text fields with validation, read-only states, and appropriate password or secret handling.
---

`Input` combines an input element with a label, help text, and validation feedback. Supply a visible `label` for ordinary forms; if the surrounding UI already labels the control, provide the corresponding accessible name yourself.

```tsx
import { Input } from '@tale/ui/input';
```

## Give the field enough context

<Demo name="input/basic" />

Use `label` for the field's name, `description` for context before entry, and `hint` for a short format or usage rule below the control. A placeholder is an example value, not a replacement for a label: it disappears when the person types.

The component generates an ID unless you pass one. It associates the label, description, hint, and error with the input, and preserves additional IDs you supply through `aria-describedby`.

## Validate and explain the fix

<Demo name="input/states" />

`errorMessage` displays an inline alert and sets the invalid state automatically; `Select` takes the same `errorMessage` and renders it the same way, under the control. `isInvalid` can also set the state without an error string, for example when a separately rendered error summary explains the problem. The component displays validation supplied by the host; it does not decide whether an email, URL, or identifier is valid for your application.

For a controlled field, pass `value` and update it from `event.target.value` in `onChange`. For an uncontrolled example, use `defaultValue`. Keep the user's draft after a failed submission and explain how to repair the value.

## Choose read-only or disabled behavior

| Need                                                       | Use                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Show a value that can be focused and copied but not edited | Native `readOnly`; it automatically selects the borderless read-only appearance unless you specify a variant. |
| Keep the outlined appearance while preventing edits        | `readOnly` with `variant="default"`.                                                                          |
| Make the control unavailable                               | `disabled`.                                                                                                   |
| Explain why it is unavailable on hover and focus           | `disabled` with `disabledReason`.                                                                             |

`variant="readOnly"` changes styling only. Pass `readOnly` as well to prevent editing. A disabled field with a reason stays focusable and read-only with `aria-disabled`; native disabled fields leave the tab order and are excluded from normal form submission. Account for that difference when reading form values.

## Distinguish account passwords from secrets

For an account sign-in field, use `type="password"` with `autoComplete="current-password"`. For a new account password, use `autoComplete="new-password"`. Explicit autocomplete lets these fields retain normal password-manager behavior.

For an API key or token, use `sensitive`. A password field with no explicit `autoComplete` is also treated as sensitive. This branch uses a text input masked with CSS, `autocomplete="off"`, and password-manager opt-out hints. These reduce unwanted autofill; they do not encrypt the value or guarantee that every browser extension ignores it. Never use a real secret in a demonstration.

The reveal toggle is enabled by default for password or sensitive fields. Set `passwordToggle={false}` to hide it. In the example, enter a sample value and use **Show password** and **Hide password** to inspect the two states.

## Props

| Prop                  | Type or default                   | Purpose                                                                              |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `label`               | Optional string                   | Visible field name; supply another accessible name if omitted.                       |
| `description`, `hint` | Optional React content            | Context above and below the control.                                                 |
| `errorMessage`        | Optional string                   | Error text and invalid state.                                                        |
| `isInvalid`           | Optional boolean                  | Additional way to mark invalid.                                                      |
| `variant`             | `default`, `unstyled`, `readOnly` | Appearance; native `readOnly` automatically selects the last when no variant is set. |
| `passwordToggle`      | `true`                            | Reveal control for a password or sensitive value.                                    |
| `sensitive`           | Optional boolean                  | Secret-entry behavior described above.                                               |
| `disabledReason`      | Optional React content            | Explanation while `disabled`.                                                        |
| `prefix`, `suffix`    | Optional React content            | Fixed text inside the outlined field; do not combine with the password toggle.       |
| `labelInfo`           | Optional React content            | Additional label tooltip.                                                            |
| `wideControl`         | `false`                           | Lets the control fill a layout-owned frame instead of the settings control column.   |
| `wrapperClassName`    | Optional string                   | Classes on `FieldShell`.                                                             |

Other native input attributes pass through, except native `size`; `prefix` is reserved for the component's fixed addon. A prefix or suffix is visual context, not part of the submitted input value. Your host must construct and validate any combined value.

## Layout and related controls

`ContentArea variant="narrow"` selects the shared settings field layout: stacked until the surface is 36rem wide, label beside control from there. See [Settings page](/docs/patterns/settings-page) before adding per-field widths.

Use `Textarea` for multiple lines, `Select` for a fixed set, `SearchableSelect` for a searchable set, `JsonInput` for structured JSON, and `CopyableField` for a value primarily meant to be copied. A table search belongs in [`DataTable.search`](/docs/components/data-table), where it can stay associated with the filtered results.

Give `SearchableSelect` a meaningful `label` or `aria-label`, including when you provide a custom trigger. Its open list and popover use `aria-label`, then the field label, then `searchPlaceholder`. The search input uses `searchPlaceholder`, then `aria-label`, then the field label. Rich field labels are referenced by ID rather than converted to text. If none is supplied, all three use the shared localized **Search** name; supply a field-specific name so the person knows what they are searching. The visible search placeholder stays optional.

## Related controls

<Demo name="input/number-stepper" />

`NumberStepper` from `@tale/ui/number-stepper` edits a small whole number, often inside a sentence. It is a text field with `role="spinbutton"`: the arrow keys step by `step` (1), Page Up and Page Down by `pageStep` (10), and Home and End jump to `min` and `max`. It accepts digits only. A number in range is committed as you type; anything else is clamped when the field loses focus or on Enter, which also calls `onEnter`, and an emptied field returns to the last value. The − and + buttons stay out of the tab order and are disabled at the bounds. Name the field with `aria-label`, or with `aria-labelledby` listing the words around it and the field's own `id`, as the example does, so it reads "Keep 2 backup copies".

<Demo name="input/toggle-chip-group" />

`ToggleChipGroup` from `@tale/ui/toggle-chip-group` picks several of a few short options. It is one tab stop; the arrow keys move between chips and Space or Enter toggles one. `minSelected` ignores only turning a chip off when that would leave fewer chips on than the minimum; turning one on always counts. The example therefore always keeps one day. Give abbreviated chips an `aria-label` that contains the visible text, such as **Monday** for **Mo**, and name the group with `aria-label` or `aria-labelledby`.

Both controls also make up the Custom view of the [recurrence picker](/docs/components/recurrence-picker).
