---
title: Schedule occurrence list
description: Show the next times a schedule starts, in the schedule's time zone, with the reader's own time and any clock change spelled out.
---

`ScheduleOccurrenceList` lists the next starts of a schedule, such as an automation that runs every weekday at 9:00. Each start is written in the schedule's own time zone, which the heading names. When the reader is in another zone, the list also gives their own time, and a start that meets a daylight-saving change says what happens to it. The component does no time-zone arithmetic: your host computes every start and passes it in.

```tsx
import type { ScheduleOccurrence } from '@tale/ui/recurrence-schedule';
import { ScheduleOccurrenceList } from '@tale/ui/schedule-occurrence-list';
```

## List the next starts

<Demo name="schedule-occurrence-list/next-runs" />

Pass `occurrences` as `ScheduleOccurrence` values, earliest first: `at` is the start in epoch milliseconds, and `timeZone` is the IANA zone the schedule runs in, such as `Europe/Zurich`. The list shows the first `count` (5 by default) as **Tue, Oct 13, 9:00 AM**, in the reader's language and hour cycle, and adds the year to a start in another year than `referenceYear`. The heading reads **Next runs · Europe/Zurich**; change its words with `label`, or leave the zone out with `showZone={false}`.

The first list in the example is the `full` variant. Its reader is in New York, so each start also gives their own time, with their date when the day differs: the first start, **Sat, Mar 28, 2:30 AM** in Zurich, reads **Fri, Mar 27, 9:30 PM in your time zone**. The second is the `compact` variant for a narrow space such as a popover: one small line per start, and one closing line that names the reader's zone instead of a time per row. The example fixes the reader's zone with `viewerTimeZone`; leave it out and the list uses the browser's.

## Explain a clock change

A start that meets a clock change carries a **Clock change** badge and a line under it that says what happens. The badge is never the only signal: the sentence is part of the page, not a tooltip. Mark the start with `clockChange`:

| `clockChange`                                   | When                                                                      | The list says                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `{ kind: 'shiftedForward', wallTime: '02:30' }` | The time of day does not exist that day; `at` is the start your host moved it to. | "2:30 AM doesn't exist that day, so this run starts at 3:30 AM."       |
| `{ kind: 'repeatedHour', interval: false }`     | The time of day happens twice; the schedule runs at the first.             | "2:30 AM happens twice that day; it runs once, at the first."             |
| `{ kind: 'repeatedHour', interval: true }`      | A grid, such as every 15 minutes, runs through the repeated hour.           | "Clocks go back: this hour repeats, and runs keep their real-time spacing." |

What a schedule does on those days is your host's rule; the list only says it. The example's first list shows the March and October changes of a schedule set to 2:30 in Zurich.

## Show starts that will not happen yet

<Demo name="schedule-occurrence-list/states" />

Set `muted` when the starts are what would happen, not what will: a schedule that is turned off, or an automation with nothing deployed. The rows turn to the muted colour; say why next to the list, and use `label` for a heading such as **Would run at**. When there is no start to show, the list says **No upcoming runs.**, or your own `emptyText`. If your host cannot compute the starts, for example because the schedule is incomplete, show your own message instead of the list.

The example's muted list is an hourly schedule on the day the clocks go back in Zurich: 2:00 AM runs twice, an hour apart, and both runs carry the `repeatedHour` mark with `interval: true`. Below it, a list with no starts.

## Accessibility

- The heading names the list: it is an ordered list labelled by the heading, so a screen reader announces "Next runs · Europe/Zurich, list, 3 items".
- Each start reads as one line of words, such as "Tue, Oct 13, 9:00 AM, 3:00 AM in your time zone". A clock change reads its badge and its sentence in the same item, such as "Sun, Mar 29, 3:30 AM, Clock change. 2:30 AM doesn't exist that day, so this run starts at 3:30 AM." The commas and the full stop are there for a screen reader only; on screen the parts sit apart.
- Muted rows, the reader's time and the clock-change line keep AA contrast in light and dark themes, and the reader's time wraps under the start in a narrow column instead of overflowing.

## Props

| Prop             | Type or default                     | Purpose                                                           |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `occurrences`    | `readonly ScheduleOccurrence[]`     | The starts your host computed, earliest first.                    |
| `count`          | `5`                                 | How many to list.                                                 |
| `variant`        | `full` or `compact`; default `full` | Rows with the reader's own time, or one small line per start.     |
| `label`          | `"Next runs"`                       | The heading.                                                      |
| `showZone`       | `true`                              | Add the schedule's zone to the heading.                           |
| `muted`          | `false`                             | Starts that would happen but will not yet.                        |
| `referenceYear`  | Optional number                     | A start in another year shows its year.                           |
| `hourCycle`      | The language's                      | `12` or `24`.                                                     |
| `emptyText`      | `"No upcoming runs."`               | What an empty list says.                                          |
| `viewerTimeZone` | The browser's zone                  | The zone the reader's own times are written in.                   |
| `id`, `className` | Optional                           | The wrapper's ID and classes.                                     |

The [recurrence picker](/docs/components/recurrence-picker) shows the same list, in its compact variant, inside its popover.
