---
title: Recurrence picker
description: Let people choose how something repeats — one-click presets or a custom rule — and show the dates it produces.
---

`RecurrencePicker` edits a repeat rule, such as "every 2 weeks on Tuesday and Thursday". It fits a property row: a compact trigger shows the rule, and its popover offers one-click presets plus a **Custom** view for any other rule. The component stores nothing and does no calendar arithmetic. Your host saves the rule, and supplies the day the presets are read from and, if you want them listed, the dates a rule produces.

```tsx
import type { RecurrenceReference, RecurrenceRule } from '@tale/ui/recurrence';
import { RecurrencePicker } from '@tale/ui/recurrence-picker';
```

## Pick a repeat

<Demo name="recurrence-picker/basic" />

Open **Repeat** and choose a row. The presets are **Never**, **Daily**, **Every weekday** (Monday to Friday), and weekly, monthly and yearly rules read from `reference`: with a due date of Tuesday, September 29, they read **Weekly on Tuesday**, **Monthly on day 29** and **Yearly on Sep 29**. A preset saves at once: the popover closes, `onChange` is called once with the new rule, and focus returns to the trigger. Choosing the preset that is already saved calls nothing, and **Never** calls `onChange(null)`.

`reference` is usually the item's due date, or today when there is none. Pass it as a `RecurrenceReference` — `year`, `month` (1 is January), `day`, and `weekday` as a `Date#getDay` number, where 0 is Sunday. The host works out the weekday in its own time zone; the package never reads the clock.

The trigger shows the rule compactly, such as **Weekly · Tue, Thu** or **Monthly · day 30**. Its tooltip holds the full sentence. `presets` limits or reorders the one-click rows; **Never** always comes first.

## Build a custom rule

<Demo name="recurrence-picker/custom" />

**Custom** replaces the preset list with an editor in the same popover. Choose **Day**, **Week**, **Month** or **Year**, set the interval ("Every 2 weeks"), and then the weekdays, the day of the month, or the month and day. The number fields clamp to their range and one weekday always stays on, so the editor cannot hold an invalid rule and **Save** is never blocked.

Custom edits are a draft for the popover session. **Save**, Enter in a number field, or Ctrl+Enter (Cmd+Enter on a Mac) calls `onChange` once. **Cancel**, Escape, or a click outside throws the draft away. **Back to presets** keeps the draft, and the list then checks whichever preset equals it — the footer stays until you save or cancel. In the example, only saving increments the counter.

A monthly rule on day 29, 30 or 31 explains that shorter months use their last day, and a yearly rule on February 29 names the date it falls on in other years. The picker only says so: what a short month does with the 31st is the host's decision. `frequencies` limits the units the editor offers, and `maxInterval` (99 by default) caps the interval.

## Show the dates a rule produces

Pass `nextDates` to list the next dates under the presets or the editor. It receives the draft rule and returns `CalendarDay` values (`year`, `month`, `day`); the picker shows the first three with their weekday, and adds the year when it differs from the reference year. Label the list with `nextDatesLabel`, such as **Next due dates**. Without `nextDates`, no list is shown.

The picker does not step a rule itself. Time zones, daylight-saving changes and clamping the 31st to a short month depend on your storage and business rules, so the dates come from the same code that will create the next item. The examples on this page use a small UTC stepper that is good enough for a demonstration.

## Add a host option

<Demo name="recurrence-picker/extra" />

When a host option belongs with the rule, pass its saved value as `extra` and render its control with `renderExtra`. The control appears below the dates in both views and receives `{ rule, extra, setExtra }`, where `rule` is the draft rule (`null` while **Never** is chosen). Its changes are drafted like a custom rule, so `onChange(rule, extra)` saves both in one call. A preset saves with the drafted option too. Return `null` to render nothing, as the example does while no rule is chosen.

The example also passes a matching `icon` and a `description`. The description is the second line of the tooltip and part of the trigger's accessible description while a rule is set.

## Explain unavailable and read-only states

<Demo name="recurrence-picker/states" />

| Need                                                        | Use                                                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The rule cannot change now, and the person should learn why | `disabled` with `disabledReason`. The trigger stays focusable with `aria-disabled`, opens nothing, keeps the rule at full contrast, and adds the reason to its tooltip and description. |
| The control is unavailable and needs no explanation         | `disabled` alone. The trigger is natively disabled and leaves the tab order.                                                                                                            |
| The person may see the rule but never edit it               | `readOnly`. The picker renders plain text with no button; screen readers hear the full sentence, and pointer users see it on hover.                                                     |

A reason should say what would make the rule editable, such as reopening the item. A disabled control is not a permission check; enforce the rule where you save it.

## Fit a narrow column

The trigger always stays on one line. When the compact rule does not fit, its tail — the weekdays or the day — drops out whole rather than being cut mid-word, and the head is truncated only if it cannot fit alone. In the states example, the narrow column shows **Every 2 weeks** without **Tue, Thu**. The accessible name, the tooltip, and the description still carry the full rule. Use `variant="default"` for a 36px outlined field in a form; the default `ghost` fits a 28px property row.

## Format a rule elsewhere

Use the same words outside the picker, such as on a card or in an activity line:

```tsx
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';

const format = useRecurrenceFormat();
format.sentence(rule); // "Every 2 weeks on Tuesday and Thursday"
format.compact(rule); // { head: 'Every 2 weeks', tail: 'Tue, Thu' }
format.day({ year: 2026, month: 10, day: 6 }, 2026); // "Tue, Oct 6"
format.never; // "Never"
```

The hook formats in the language the i18n instance renders. Outside React, `formatRecurrence(rule, t, locale)` and `formatRecurrenceCompact` from `@tale/ui/recurrence-format` take a `t` bound to the `recurrence` namespace. `@tale/ui/recurrence` holds the rule helpers: `normalizeRecurrence` returns a rule with only its own keys and sorted weekdays, `sameRecurrence` compares two rules and ignores extra keys, and `matchRecurrencePreset` names the preset a rule equals.

A host may keep keys of its own on a rule, such as a time zone. The picker accepts them in `value`, ignores them when it compares, and always emits a normalized rule, so add them back in `onChange`.

## Embed the editor in a form

`RecurrenceEditor` is the Custom view's form body without the popover. Use it when the rule is one field of a larger form:

```tsx
import { recurrenceDraft, recurrenceFromDraft } from '@tale/ui/recurrence';
import { RecurrenceEditor } from '@tale/ui/recurrence-editor';

const [draft, setDraft] = useState(() => recurrenceDraft(savedRule, reference));

<RecurrenceEditor aria-label="Repeat" draft={draft} onDraftChange={setDraft} />;
// On submit: save recurrenceFromDraft(draft).
```

The editor keeps each unit's own setting in the draft, so switching from **Month** to **Week** and back keeps the day of the month. It renders no `<form>` of its own; `onSubmit` is called on Enter in a number field. Name the editor with `aria-label`, or `aria-labelledby` pointing at a visible heading.

## Accessibility

- The trigger's name is the control's label followed by the visible rule, such as "Repeat: Weekly, Tue", so a voice command that reads the visible text reaches it. The full sentence, your `description` and any lock reason form its accessible description whether or not the tooltip is open.
- The popover is a dialog named by `label`. It is modal by default: focus stays inside, and it returns to the trigger on close. Keep `modal` inside a Dialog, Sheet or Drawer, whose scroll lock would otherwise block wheel scrolling in the popover. Escape closes only the top layer, such as the month list.
- The presets are one radio group and one tab stop. The arrow keys move between rows without choosing; Space or Enter chooses and saves. **Custom** is a button whose description is the draft rule when it matches no preset.
- In the Custom view, focus starts on the checked unit. **Back to presets** returns focus to **Custom**. Each number field's name reads as its sentence, such as "Every 2 weeks" or "On February 29". The weekday chips are one tab stop with the arrow keys between them, and each chip is named by the full day name. A status message announces the settled rule after you stop changing it.
- Rows are 36px tall, weekday chips and the Back button 32px, and the number field's buttons 32px wide. The pressed chip is filled, so its state does not rely on colour alone.

## Props

| Prop                          | Type or default                         | Purpose                                                                  |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `value`                       | `RecurrenceRule \| null`                | The saved rule. Extra host keys are accepted and ignored.                |
| `onChange`                    | `(rule, extra?) => void`                | Called once per popover session, only when something changed.            |
| `reference`                   | `RecurrenceReference`                   | The day the presets and a new custom rule are read from.                 |
| `label`                       | `"Repeat"`                              | Name prefix of the trigger and name of the popover.                      |
| `description`                 | Optional string                         | Second tooltip line and part of the description while a rule is set.     |
| `icon`                        | Lucide icon; default `Repeat`           | The trigger's icon.                                                      |
| `nextDates`, `nextDatesLabel` | Optional function; `"Next dates"`       | The host's upcoming dates for the draft rule; the first three are shown. |
| `extra`, `renderExtra`        | Optional, together                      | A host option drafted and saved with the rule.                           |
| `presets`                     | All five                                | One-click rows after **Never**.                                          |
| `frequencies`                 | All four                                | Units the Custom view offers.                                            |
| `maxInterval`                 | `99`                                    | Largest interval.                                                        |
| `disabled`, `disabledReason`  | `false`; optional React content         | Unavailable trigger, focusable when a reason is given.                   |
| `readOnly`                    | `false`                                 | Plain text instead of a control.                                         |
| `variant`                     | `ghost` or `default`; default `ghost`   | 28px property row or 36px outlined field.                                |
| `align`                       | `start`, `center`, `end`; default `end` | Popover alignment.                                                       |
| `modal`                       | `true`                                  | Focus trapping and scroll isolation.                                     |
| `id`, `className`             | Optional                                | Trigger ID and classes.                                                  |
