---
title: Time field
description: Let people enter a time of day in their own hour cycle, with segmented parts they can step, type or paste.
---

`TimeField` edits a time of day, such as the hour a schedule starts. It shows the time the way the reader's language writes it — **9:30 AM** in English, **09:30** in German and French — and splits it into parts you can step with the arrow keys, type, or replace by pasting a whole time. It always holds a valid time, so there is no empty state to validate.

```tsx
import { TimeField } from '@tale/ui/time-field';
import type { TimeOfDay } from '@tale/ui/time-of-day';
```

## Pick a time

<Demo name="time-field/basic" />

`value` is a `TimeOfDay`: `hour` from 0 to 23 and `minute` from 0 to 59, on the wall clock. `onValueChange` receives the new time each time a part is committed, and only when the time changed. The field never reads a clock or a time zone; what the time means — which day, which zone — is your host's decision.

By default the field uses the hour cycle of the language the page renders in. Pass `hourCycle={12}` or `hourCycle={24}` to fix it, as the example does. On a 12-hour clock the hour reads 1 to 12 and a third part holds the day period, such as **AM** and **PM**; the stored `hour` is still 0 to 23. The example shows the stored value under the fields.

Name the field with `label`, or with `aria-label` or `aria-labelledby` when the surrounding layout already shows its name, such as **From** and **Until** beside a pair of fields.

## Step, type and paste

Each part — hour, minute and, on a 12-hour clock, the day period — is a tab stop and a spin button.

| Key                         | Hour                                                     | Minute                       | Day period         |
| --------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------ |
| Up Arrow / Down Arrow       | One hour, wrapping from 23 to 0 (12 to 1 on a 12-hour clock) | `minuteStep` (1), wrapping from 59 to 0 | Switches AM and PM |
| Page Up / Page Down         | 6 hours, wrapping                                        | 15 minutes, wrapping         | Switches AM and PM |
| Home / End                  | First and last hour                                      | 0 and 59                     | AM and PM          |
| Left Arrow / Right Arrow    | Previous or next part                                    | Previous or next part        | Previous or next part |
| Digits                      | Fill the hour                                            | Fill the minutes             | —                  |
| A / P                       | —                                                        | —                            | AM or PM           |
| Backspace / Delete          | Clears the part while you retype it                      | Clears the part              | —                  |
| Enter                       | Commits the part, then calls `onEnter`                   | Same                         | Same               |

The arrows never carry into the next part: stepping the minutes past 59 does not change the hour. Typing moves on as soon as a part is complete. On a 24-hour clock, **7** is 07 and moves to the minutes, while **2** waits for a second digit, because it could start 20 to 23. On a 12-hour clock, **1** waits for 10, 11 or 12. A part typed halfway is committed when you leave it, and a part you cleared and left empty returns to its last value. Typing `:`, `.` or `h` in the hour moves to the minutes.

Pasting a whole time into any part replaces the time: `17:30`, `1730`, `17h30`, `17.30` and `5:30 pm` all work. Anything else leaves the time unchanged, and a screen reader hears an example of what the field takes. The wheel never changes a time, so scrolling a popover over the field is safe. Escape is left to the surrounding layer, such as the popover it sits in.

## Show states

<Demo name="time-field/states" />

`description` sits under the label, and `errorMessage` marks every part invalid and shows the message under the field. The field has no rules of its own: a time outside your range is your host's error, as in the example, where a reminder before office hours is refused.

A `label` or `description` puts the field in the standard label-and-field frame; keep them for the field's whole life. Without them, the field renders bare and an `errorMessage` follows it as its next sibling, so place the two in a column. An error that appears or clears while someone types never remounts the field, so focus and a part typed halfway stay where they are.

| Need                                          | Use                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| The time cannot change now                    | `disabled`. The parts are dimmed and leave the tab order.                               |
| People may read and select the time but not edit it | `readOnly`. The parts stay focusable; the arrows, typing and pasting change nothing. |
| A denser row                                  | `size="sm"`, a 32px field instead of the default 36px.                                  |

## Accessibility

- The field is a group named by its label. Its description starts with the whole time as the locale writes it, then your `description`, error and `aria-describedby`, so entering the group announces the time before any help, such as "Until, 6:00 PM".
- Each part is a spin button with its own name (**Hours**, **Minutes**, **AM/PM**) and a spoken value: the hour as "9 PM" or "21 Uhr", the minutes as "30 minutes", the day period as its word. A cleared part reads "Empty".
- The ring around the field shows that it has focus, and the focused part is filled in the accent colour, as a pressed chip is, so you can see which part a digit goes into. The fill keeps more than 3:1 contrast against the field in both themes.
- Clicking the label focuses the hour; clicking the field's padding or separator focuses the nearest part.
- Every part is at least 24px wide and 24px tall. On a phone, a part scrolls into view when it takes focus, and the hour and minutes open the numeric keyboard.

## Props

| Prop                               | Type or default                  | Purpose                                                        |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `value`                            | `TimeOfDay`                      | The time, `hour` 0–23 and `minute` 0–59.                       |
| `onValueChange`                    | `(value: TimeOfDay) => void`     | Called once per committed change, only when the time differs.  |
| `hourCycle`                        | The language's                   | `12` or `24`.                                                  |
| `minuteStep`                       | `1`                              | What the arrow keys add to the minutes.                        |
| `pageStep`                         | `{ hour: 6, minute: 15 }`        | What Page Up and Page Down add.                                |
| `onEnter`                          | Optional function                | Called on Enter, after a part typed halfway is committed.      |
| `label`, `description`, `errorMessage` | Optional                     | The field's name, help text and error.                         |
| `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-invalid` | Optional | Naming and state when the layout supplies them.        |
| `disabled`, `readOnly`             | `false`                          | Unavailable, or readable but not editable.                     |
| `size`                             | `default` or `sm`                | A 36px or 32px field.                                          |
| `id`, `className`, `wrapperClassName` | Optional                      | The group's ID and classes; classes for the frame a `label` or `description` brings. |

`@tale/ui/time-of-day` holds the helpers the field is built on: `formatTimeOfDay(time, locale, cycle?)` writes a time the way the locale does, `localHourCycle(locale)` reads a language's hour cycle, `parseTimeText(text)` reads a pasted time, and `compareTime`, `sameTime` and `clampTime` order, compare and bound times.
