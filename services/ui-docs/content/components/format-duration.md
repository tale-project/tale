---
title: Format durations
description: Say how long something took in the reader's language, and show a duration that counts on while it runs.
---

`formatDuration` says a span of time in the reader's words, from milliseconds: how long a step took, how long a run has been waiting, a time limit. `Duration` puts it on the page as a `<time>` element and, for a span still open, counts on once a second. `useNow` is the shared clock behind it.

```tsx
import {
  Duration,
  durationIso,
  formatDuration,
  useFormatDuration,
  useNow,
} from '@tale/ui/format-duration';
```

## Say a duration

<Demo name="format-duration/basic" />

`formatDuration(ms, locale, options)` picks its units by the size of the span, so a reader sees the precision that matters:

| Span              | English, `short`      |
| ----------------- | --------------------- |
| Under a second    | `320 ms`              |
| Under ten seconds | `3.2 sec`, to a tenth |
| Under a minute    | `42 sec`              |
| Under an hour     | `3 min, 12 sec`       |
| Under a day       | `2 hr, 5 min`         |
| A day or more     | `1 day, 3 hr`         |

`style` writes the units `short` (the default), `narrow` (`3m 12s`) or `long` (`3 minutes, 12 seconds`). `maxUnits: 1` keeps the largest unit alone, to one decimal: `1.5 minutes` for a limit, `3.2 min` for a narrow strip. The smaller unit is left out when it is zero (`3 min`). A negative span reads as zero, which two clocks that disagree can produce, and a value that is not a number reads `—`.

Each unit is written by `Intl.NumberFormat` and the units are joined by `Intl.ListFormat`, the two steps `Intl.DurationFormat` takes: the words are the ones the browser's own duration format would say, in every language, also in browsers without `Intl.DurationFormat`. German reads `3 Min., 12 Sek.` and French `3 min et 12 s`.

In a component, `useFormatDuration()` returns `formatDuration` bound to the reader's language. `durationIso(ms)` writes the exact span as an ISO 8601 duration, such as `PT3.24S`, for a machine to read.

## Show a duration on the page

`<Duration ms={3240} />` renders `<time dateTime="PT3.24S">3.2 sec</time>`. For a span still open, pass when it began as `since` (epoch milliseconds) and `live`: the text counts on once a second. Without `live`, a `since` reads once, when the component first draws. `unitDisplay` (`narrow`, `short` or `long`) and `maxUnits` pass through to `formatDuration` as its `style` and `maxUnits`.

Every live duration on the page ticks on one clock: fifty running steps start one timer, not fifty, and change together. `useNow(intervalMs)` gives a component that clock directly: the current time, read again every interval, from one timer per interval that stops when its last reader unmounts. Pass `false` as its second argument to read the time once instead.

## Accessibility

A duration is text in a `<time>` element, with the exact span in `dateTime`. A live duration changes quietly, with `aria-live="off"`: a counter announced every second would talk over everything else. Say the duration in a status message when it matters, such as "Finished after 3.2 sec". Its digits are tabular, so a ticking number does not shift the text beside it.
