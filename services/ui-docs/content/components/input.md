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

For an API key or token, use `sensitive`. A password field with no explicit `autoComplete` is also treated as sensitive. This branch uses a text input masked with CSS, `autocomplete="off"`, and password-manager opt-out hints, and it asks the browser not to spell-check, capitalize or correct the value, which a real password input never gets either. These reduce unwanted autofill; they do not encrypt the value or guarantee that every browser extension ignores it. Never use a real secret in a demonstration.

Masking here is visual only. A `sensitive` field is a text input drawn as dots, so assistive technology reads its value as it reads any text field's. A single-line secret that must stay out of the accessibility tree needs a real password input: `type="password"` with an explicit `autoComplete` (`"off"` for a secret that is not an account password), plus the opt-out hints `data-1p-ignore`, `data-lpignore="true"`, `data-form-type="other"` and `data-bwignore="true"`. The browser then treats the field as a password, so it may still offer to fill or save one; the hints reduce that and cannot promise to stop it.

The reveal toggle is enabled by default for password or sensitive fields. Set `passwordToggle={false}` to hide it. In the example, enter a sample value and use **Show password** and **Hide password** to inspect the two states.

## Reveal and copy a secret value inside the field

<Demo name="input/secret" />

A value someone may need to check or hand on (a card number, a token, a recovery code) is a masked field with its tools inside its border, so a column of fields still ends on one edge. Add `copyable` for a copy button beside the reveal toggle: it copies what the field holds at that moment, shown or not, and never shows it. An empty field copies nothing, and a browser that refuses the clipboard raises the shared "Couldn't copy to clipboard" toast instead of claiming success.

Name the buttons for what they act on when several values stand together. `revealLabels` replaces "Show password" and "Hide password" (`{ show: 'Show card number', hide: 'Hide card number' }`), `copyLabel` names the copy button, and `copiedLabel` is what a screen reader hears once the value is on the clipboard. On a touch screen each button takes a 44px target. The box the buttons sit in takes no clicks of its own, so a click beside a button still focuses the field.

The first field of the example is the recipe for a single-line secret that must stay out of the accessibility tree: a real password input, as described above. The second is a `Textarea`, which takes the same props (`sensitive`, `passwordToggle`, `revealLabels`, `copyable`, `copyLabel`, `copiedLabel`) for a secret of several lines: the browser masks the text until it is shown, and the buttons sit in the field's corner. A text area has no password form, so its masking is visual only and a screen reader still reads every line.

A fixed `prefix` or `suffix` has a frame of its own. Beside one, a lone `copyable` gives way: the addon keeps its frame and no copy button is drawn. On a masked field the reveal toggle's frame takes the addon's place (an addon is never drawn beside the toggle), so `copyable` works there and the `prefix` or `suffix` is not drawn.

A reveal belongs to the masking that gave it. When a field stops being masked (its `type` or `sensitive` changes, or `passwordToggle` turns off), whatever was shown is hidden again once the mask returns. Turning `copyable` on or off, or masking a field, after it mounted changes the frame the input is drawn in and remounts it: an uncontrolled field loses what was typed and its focus. Give the field a `key` that changes with them, or keep them constant.

## Props

| Prop                  | Type or default                   | Purpose                                                                                                        |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `label`               | Optional string                   | Visible field name; supply another accessible name if omitted.                                                 |
| `description`, `hint` | Optional React content            | Context above and below the control.                                                                           |
| `errorMessage`        | Optional string                   | Error text and invalid state.                                                                                  |
| `isInvalid`           | Optional boolean                  | Additional way to mark invalid.                                                                                |
| `variant`             | `default`, `unstyled`, `readOnly` | Appearance; native `readOnly` automatically selects the last when no variant is set.                           |
| `type`                | Native input type                 | `password` without an explicit `autoComplete` is treated as `sensitive`; with one it is a real password input. |
| `passwordToggle`      | `true`                            | Reveal control for a password or sensitive value; `false` leaves the value masked for good.                    |
| `sensitive`           | Optional boolean                  | Secret-entry behavior described above: masked on screen only, readable to assistive technology.                |
| `revealLabels`        | Optional `{ show, hide }`         | Names of the reveal toggle, for when "Show password" does not say what is revealed.                            |
| `copyable`            | `false`                           | A copy button inside the field, beside the reveal toggle; a lone one gives way to a `prefix` or `suffix`.      |
| `copyLabel`           | Optional string                   | Name of the copy button (default "Copy").                                                                      |
| `copiedLabel`         | Optional string                   | What a screen reader hears after copying (default "Copied").                                                   |
| `disabledReason`      | Optional React content            | Explanation while `disabled`.                                                                                  |
| `prefix`, `suffix`    | Optional React content            | Fixed text inside the outlined field; do not combine with the password toggle.                                 |
| `labelInfo`           | Optional React content            | Additional label tooltip.                                                                                      |
| `wideControl`         | `false`                           | Lets the control fill a layout-owned frame instead of the settings control column.                             |
| `wrapperClassName`    | Optional string                   | Classes on `FieldShell`.                                                                                       |

Other native input attributes pass through, except native `size`; `prefix` is reserved for the component's fixed addon. A prefix or suffix is visual context, not part of the submitted input value. Your host must construct and validate any combined value.

## Textarea

`Textarea` is the multi-line field. It has the label, description and error of `Input`, and the secret props described above.

```tsx
import { Textarea } from '@tale/ui/textarea';
```

| Prop                       | Type or default                         | Purpose                                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `label`, `description`     | Optional string, optional React content | Visible field name and context above the control.                                                                                                                                                                        |
| `errorMessage`             | Optional string                         | Error text and invalid state.                                                                                                                                                                                            |
| `counterMax`               | Optional number                         | A `used / max` counter under the control, in the UI language's number format. Display only: it does not cap the input, and the count turns destructive past the max. It describes the field without being a live region. |
| `counterValue`             | Optional number                         | The length the counter shows when you measure it differently, for example trimmed as the save sends it.                                                                                                                  |
| `wideControl`              | `false`                                 | Spans the full row in the settings row layout instead of the standard control column.                                                                                                                                    |
| `fillHeight`               | `false`                                 | Fills the height a flex parent grants and scrolls inside, for an editor-style body rather than a form field.                                                                                                             |
| `wrapperClassName`         | Optional string                         | Classes on the outer frame.                                                                                                                                                                                              |
| `disabledReason`           | Optional React content                  | Explanation while `disabled`; as on `Input`, the field then stays focusable and read-only with `aria-disabled`.                                                                                                          |
| `overlay`                  | Optional React content                  | Drawn over the control's own box, for highlights that follow its text. It never takes the pointer.                                                                                                                       |
| `sensitive`                | `false`                                 | The text is a secret: masked by the browser until shown, no autofill, save prompt, spell check, capitalization or correction. Masking is visual only: a screen reader still reads every line.                            |
| `passwordToggle`           | `true`                                  | The reveal toggle of a `sensitive` text; `false` leaves it masked for good.                                                                                                                                              |
| `revealLabels`             | Optional `{ show, hide }`               | Names of the reveal toggle (default "Show value" and "Hide value").                                                                                                                                                      |
| `copyable`                 | `false`                                 | A copy button in the field's corner; it copies all the text, shown or not, and never shows it.                                                                                                                           |
| `copyLabel`, `copiedLabel` | Optional string                         | Name of the copy button (default "Copy") and what a screen reader hears after copying (default "Copied").                                                                                                                |

Other native `textarea` attributes pass through. Adding or removing the buttons or an `overlay` after the field mounted remounts the text area, as described for `Input`: key the field when they change.

## Show a value that is read, not typed

<Demo name="input/copyable-field" />

`CopyableField` is a read-only pill with a copy button, for a value people mostly copy: an ID, a URL, a token.

```tsx
import { CopyableField } from '@tale/ui/copyable-field';
```

A plain value is the pill itself: one button, named by its label and value, that copies on press. It shows one line and cuts a longer value short.

Two props change what the pill is. `masked` is for a secret: dots stand for the value until the eye shows it, the copy button copies it without showing it, and while it is masked the value is nowhere in the page, not in the text, a name or a tooltip. A screen reader hears "Hidden" for the dots. `wrap` shows the whole value, wrapped at the pill's edge with its line breaks kept, for a note or a long answer. Either one makes the pill hold real buttons beside the text, so it is no longer one button: name the copy button with `copyAriaLabel`, and the eye with `revealLabels` when "Show value" does not say which value. A value that stops being masked and is masked again starts hidden. Masking keeps a value off the page; it does not encrypt it.

| Prop                          | Type or default                         | Purpose                                                                                             |
| ----------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `value`                       | String                                  | The value to show and copy.                                                                         |
| `label`, `description`        | Optional string, optional React content | The name of the field and context under the pill.                                                   |
| `mono`                        | `true`                                  | Monospace text; pass `false` for prose.                                                             |
| `masked`                      | `false`                                 | Keeps the value off the page until the eye shows it.                                                |
| `wrap`                        | `false`                                 | Shows the whole value, wrapped, with its line breaks.                                               |
| `revealLabels`                | Optional `{ show, hide }`               | Names of the eye (default "Show value" and "Hide value").                                           |
| `hiddenLabel`                 | Optional string                         | What a screen reader hears for the dots (default "Hidden").                                         |
| `copyAriaLabel`               | Optional string                         | Name of the copy button of a `masked` or `wrap` pill; a plain pill is named by its label and value. |
| `copiedLabel`                 | Optional string                         | What a screen reader hears once the value is copied (default "Copied").                             |
| `copiedDuration`              | `2000`                                  | How long the copied mark stays, in milliseconds.                                                    |
| `onCopy`, `onCopyError`       | Optional callbacks                      | Called when the copy succeeded, or when the browser refused it.                                     |
| `inputClassName`, `className` | Optional string                         | Classes on the pill and on the outer wrapper.                                                       |

## Layout and related controls

`ContentArea variant="narrow"` selects the shared settings field layout: stacked until the surface is 36rem wide, label beside control from there. See [Settings page](/docs/patterns/settings-page) before adding per-field widths.

Use `Textarea` for multiple lines, `Select` for a fixed set, `SearchableSelect` for a searchable set, `JsonInput` for structured JSON, and `CopyableField` for a value primarily meant to be copied. A table search belongs in [`DataTable.search`](/docs/components/data-table), where it can stay associated with the filtered results.

Give `SearchableSelect` a meaningful `label` or `aria-label`, including when you provide a custom trigger. Its open list and popover use `aria-label`, then the field label, then `searchPlaceholder`. The search input uses `searchPlaceholder`, then `aria-label`, then the field label. Rich field labels are referenced by ID rather than converted to text. If none is supplied, all three use the shared localized **Search** name; supply a field-specific name so the person knows what they are searching. The visible search placeholder stays optional.

## Related controls

<Demo name="input/number-stepper" />

`NumberStepper` from `@tale/ui/number-stepper` edits a small whole number, often inside a sentence. It is a text field with `role="spinbutton"`: the arrow keys step by `step` (1), Page Up and Page Down by `pageStep` (10), and Home and End jump to `min` and `max`. It accepts digits only. A number in range is committed as you type; anything else is clamped when the field loses focus or on Enter, which also calls `onEnter`, and an emptied field returns to the last value. A form that must not correct a number behind the person's back passes `onOutOfRange`: a number out of range then stays as typed, the callback receives it (and `null` once the number is in range again), and the form shows the error and holds its submit. The field is as wide as the longest number between `min` and `max`, so 100000 is never cut off. The − and + buttons stay out of the tab order and are disabled at the bounds. Name the field with `aria-label`, or with `aria-labelledby` listing the words around it and the field's own `id`, as the example does, so it reads "Keep 2 backup copies".

<Demo name="input/toggle-chip-group" />

`ToggleChipGroup` from `@tale/ui/toggle-chip-group` picks several of a few short options. It is one tab stop; the arrow keys move between chips and Space or Enter toggles one. `minSelected` ignores only turning a chip off when that would leave fewer chips on than the minimum; turning one on always counts. The example therefore always keeps one day. Give abbreviated chips an `aria-label` that contains the visible text, such as **Monday** for **Mo**, and name the group with `aria-label` or `aria-labelledby`.

Both controls also make up the Custom view of the [recurrence picker](/docs/components/recurrence-picker).

For a time of day, use [Time field](/docs/components/time-field) rather than a text input or the browser's own time input: it shows hours and minutes as separate parts in the reader's hour cycle, the arrow keys step them, and a pasted time such as `17:30` replaces the whole value.
