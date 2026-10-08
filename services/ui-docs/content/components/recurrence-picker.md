---
title: Recurrence picker
description: Let people choose how something repeats, or when a schedule runs — one-click presets or a custom rule — and show the dates or runs it produces.
---

`RecurrencePicker` edits a repeat rule, such as "every 2 weeks on Tuesday and Thursday". It fits a property row: a compact trigger shows the rule, and its popover offers one-click presets plus a **Custom** view for any other rule. The component stores nothing and does no calendar arithmetic. Your host saves the rule, and supplies the day the presets are read from and, if you want them listed, the dates a rule produces.

With `granularity="time"`, the same picker edits a schedule instead: when something starts, such as every weekday at 9:00 and 17:30, or every 15 minutes during office hours. See [Schedule with times of day](#schedule-with-times-of-day).

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

## Schedule with times of day

<Demo name="recurrence-picker/schedule" />

Set `granularity="time"` to edit a schedule rather than the days something repeats on. The value is a `ScheduleRule` from `@tale/ui/recurrence-schedule`: either a repeat rule with one to twelve `times` of day, such as every weekday at `"09:00"` and `"17:30"`, or a grid that starts every few minutes or hours. Times are `"HH:MM"` strings on a 24-hour clock in `value` and `onChange`, whatever clock the reader sees. The trigger is named **Schedule** unless you pass a `label`, and the popover is 320px wide.

The presets are **Every 15 minutes**, **Every hour**, and daily, weekday, weekly and monthly rules at a time of day. The day presets read the weekday and day of the month from `reference`, and their time from the saved rule's earliest time, else `reference.time`, else 9:00. With "Daily at 7:30 AM" saved, the list therefore offers **Every weekday at 7:30 AM**. As in day mode, a preset saves at once, and `presets` limits or reorders them.

**Custom interval** builds a grid: every 1 to 30 minutes or 1 to 12 hours (steps that divide an hour or a day), at a number of minutes past the hour when the step is in hours, on the weekdays you keep on, and — with **Only between** — only between two times. A grid counts from local midnight, so "every 2 hours at 15 minutes past the hour" starts at 00:15, 02:15 and so on. The hours include the start and stop before the end: 8:00 to 18:00 every 15 minutes starts last at 17:45. An end earlier than the start runs overnight, and the hours after midnight belong to the day the window started on, so Friday from 22:00 to 06:00 runs into Saturday morning but not on Saturday evening. An end of 00:00 runs until midnight, and the same start and end means all day.

Under the hours, the picker names the day's first and last start, or its one start, and says which of them fall the next morning: from 21:00 until 03:00, every 4 hours runs once, at midnight. When no start falls between the hours — every 6 hours, from 8:00 to 11:00 — the sentence turns red, both times are marked invalid, and **Save** stays unavailable with the same reason until the hours or the step change. The next runs disappear too, since the rule would never run.

**Custom times** is the day picker's **Custom** editor with an **At** list of times below it, each a [Time field](/docs/components/time-field). **Add time** adds a row an hour after the last one, up to `maxTimes` (12). Every row has a remove button once there are two. Rows keep the order you typed them in while you draft, and a time that is already in the list says it runs once; saving sorts the times and drops the repeat. The two custom views share one draft, so switching between them loses neither.

`allowNever={false}` leaves out **Never**: `value` and `onChange` are then never `null`, which suits a schedule that exists for as long as its trigger does. `customViews` limits or reorders the two custom views, `minuteIntervals` and `hourIntervals` the steps **Every** offers, and `frequencies` and `maxInterval` the days in **Custom times**. Times follow the reader's language — 9:00 AM in English, 09:00 in German and French — unless `hourCycle` fixes 12 or 24.

### Show the next runs

Pass `nextOccurrences(rule, extra)` to list the draft's next three runs under the views, as the first example does. Return `ScheduleOccurrence` values that your host computes in the schedule's time zone; the picker shows them in a compact [schedule occurrence list](/docs/components/schedule-occurrence-list), which names the zone, says when the reader is in another one, and explains a start that meets a clock change. The picker does no time-zone arithmetic of its own. Label the list with `nextOccurrencesLabel`. When your host cannot compute the runs, return `[]` and explain why outside the picker. The first example uses a small engine in the demo file that ignores clock changes.

### Keep the time zone with the rule

A schedule runs in a time zone, and the rule does not carry one. When the picker is the only control, draft the zone with the rule through `extra` and `renderExtra`, as the first example does with its **Time zone** select: **Save** then commits both in one `onChange(rule, zone)`, and `nextOccurrences` receives the drafted zone. When the surrounding form already has a time zone field, keep the zone there instead of adding a second control for it, pass it to `nextOccurrences`, and name it in `description`.

<Demo name="recurrence-picker/schedule-interval" />

The second example keeps **Never**, so `onChange` can receive `null`, and starts on "every 15 minutes, Monday to Friday, 8:00 AM to 6:00 PM". Its `label` names the control after the work it schedules.

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

format.schedule(scheduleRule); // "Every weekday at 9:00 AM and 5:30 PM"
format.scheduleCompact(scheduleRule); // { head: 'Weekdays', tail: '9:00 AM, 5:30 PM' }
format.time('17:30'); // "5:30 PM"
format.occurrence({ at, timeZone: 'Europe/Zurich' }, 2026); // "Tue, Oct 13, 9:00 AM"
format.hourCycle; // 12 in English, 24 in German and French
```

The schedule members word a `ScheduleRule` — a repeat rule with times of day, or a grid of every N minutes or hours — in the reader's hour cycle; pass `12` or `24` as their last argument to fix it. `format.occurrence` writes an upcoming start in its schedule's time zone and adds the year when it differs from the one you pass. Wherever a screen names a schedule — a card, a canvas node, an activity line — use these members rather than wording it yourself, so every surface says the same thing.

The hook formats in the language the i18n instance renders. Outside React, `formatRecurrence(rule, t, locale)`, `formatRecurrenceCompact`, `formatSchedule`, `formatScheduleCompact` and `formatOccurrence` from `@tale/ui/recurrence-format` take a `t` bound to the `recurrence` namespace. `@tale/ui/recurrence` holds the rule helpers: `normalizeRecurrence` returns a rule with only its own keys and sorted weekdays, `sameRecurrence` compares two rules and ignores extra keys, and `matchRecurrencePreset` names the preset a rule equals. `@tale/ui/recurrence-schedule` holds the same for schedule rules: `normalizeSchedule`, `sameSchedule`, `schedulePreset`, `matchSchedulePreset`, and `windowStarts`, which names a grid's first and last start inside its hours, or `null` when none falls inside them. Times in a schedule rule are `"HH:MM"` strings on a 24-hour clock; `parseScheduleTime` and `formatScheduleTime` convert them to and from a `TimeOfDay`.

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
- In time mode, focus starts on the checked preset, else on the custom row of the draft's kind, and **Back to presets** returns it to the row that opened the view. In **Custom interval**, focus starts on **Every**; the minutes field reads as "15 minutes past the hour", and the two time fields are named **From** and **Until** and described by the sentence under them, which also marks them invalid when no run falls between them.
- In **Custom times**, the time fields are named **Time 1**, **Time 2** and so on, and each remove button names its time, such as "Remove 9:00 AM". Adding a time moves focus to its hour; removing one moves it to the row now in that place, or the last row. A status message announces the settled schedule after you change a time. Enter in any time or number field saves, as Ctrl+Enter does anywhere in the popover; neither saves a window that never runs.
- The views switch with a short fade of their content, opacity only, and a new time row drops in; with reduced motion, both are instant. Remove buttons are 32px, **Add time** 32px tall, and every part of a time field at least 24px.

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

In time mode (`granularity="time"`), these props differ or are added:

| Prop                                     | Type or default                                | Purpose                                                                                   |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `granularity`                            | `"day"` (default) or `"time"`                  | Calendar days, or a schedule with times of day.                                           |
| `value`                                  | `ScheduleRule \| null`; never null with `allowNever={false}` | The saved schedule. Extra host keys are accepted and ignored.                |
| `reference`                              | `ScheduleReference`                            | The day the presets are read from, and `time`, the time a new rule starts at.             |
| `label`                                  | `"Schedule"`                                   | Name prefix of the trigger and name of the popover.                                       |
| `allowNever`                             | `true`                                         | Offer **Never**; `false` makes `value` and `onChange` non-null.                           |
| `presets`                                | All six                                        | One-click rows, from **Every 15 minutes** to monthly.                                     |
| `customViews`                            | `['interval', 'times']`                        | The custom views offered, in order.                                                       |
| `minuteIntervals`, `hourIntervals`       | Every step that divides an hour or a day       | The steps **Every** offers.                                                               |
| `frequencies`, `maxInterval`             | All four; `99`                                 | The day units and widest step in **Custom times**.                                        |
| `maxTimes`                               | `12`                                           | The most times of day a rule may have.                                                    |
| `hourCycle`                              | The language's                                 | `12` or `24` for every time the picker shows.                                             |
| `nextOccurrences`, `nextOccurrencesLabel` | Optional function; `"Next runs"`              | The host's next runs for the draft rule, in the schedule's zone; the first three are shown. |
| `extra`, `renderExtra`                   | Optional, together                             | A host option, such as the time zone, drafted and saved with the rule.                    |
