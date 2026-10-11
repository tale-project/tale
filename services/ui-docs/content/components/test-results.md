---
title: Test results
description: List the results of a run of tests, count and announce the run, and say how much of a document the tests cover.
---

`TestResultList` shows how each test in a run went: whether it passed, failed or couldn't run, why, and how long it took. Use it for checks that ran, such as a suite run when a version is saved or one test run by hand. Problems found by reading a document belong in an [issue list](/docs/components/issue-list). The list shows what the host gives it; it runs nothing itself.

```tsx
import {
  TestCountButton,
  TestCoverage,
  TestResultList,
  TestRunAnnouncer,
  TestStatusIcon,
  countTestStatuses,
  formatTestCounts,
  type TestResultItem,
} from '@tale/ui/test-results';
```

## Show the results of a run

<Demo name="test-results/basic" />

Pass `onActivate` and every row becomes a button. Choose a row and the example says which test it shows; in an application, `onActivate` opens the test and shows its run. Pass the id of the row you show as `activeId`, so the list marks it with `aria-current` and keyboard focus starts there next time.

The list is a single tab stop. Up and Down move between rows, Home and End jump to the first and last, and Enter or Space activates the row. `renderActions` adds controls beside a row's button, such as the example's **Run** or a menu. It receives the row and `{ tabIndex, current }`. Pass `tabIndex` to your controls, so they join the tab order only while their row is the current one: Tab then moves from the row to its actions and out of the list. Clicking a control makes its row the current one. Never put controls in `badges` or `meta`, which render inside the row's button.

Without `onActivate` the list is static: its rows are text, and the controls from `renderActions` stay in the normal tab order. Use it on a run page or in a version's summary. Name a list with `aria-label` or `aria-labelledby`; without either it is called "Test results".

## Write each result for the reader

| Field    | What it holds                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------- |
| `id`     | Stable across runs, so focus and the current row survive a re-run.                             |
| `status` | One of the statuses below.                                                                     |
| `name`   | The test's name. It wraps rather than truncates.                                               |
| `reason` | One line on why, such as "The output differs from what the test expects in 1 place."           |
| `meta`   | A short figure from the result, such as "120 ms" or "unsaved", on the trailing edge.           |
| `badges` | Text chips under the reason, such as "Simulates 2 nodes". `density="compact"` leaves them out. |

Translate every field before you pass it in; the list adds only its own words, from the package's `testResults` catalog.

| Status    | Glyph                        | Word                      |
| --------- | ---------------------------- | ------------------------- |
| `passed`  | A tick in the success colour | Passed                    |
| `failed`  | A crossed circle in red      | Failed                    |
| `error`   | An alert circle in amber     | Couldn't run              |
| `running` | A spinner                    | Running                   |
| `queued`  | A clock                      | Waiting                   |
| `not-run` | A dashed circle              | Not run yet               |
| `stale`   | A clock turning back         | Changed since this result |

A status never relies on colour. Each row has its status's glyph and a visually hidden word before the name, so the row's accessible name is the word, the name and the reason, such as "Failed: Big order gets a discount" followed by the reason. A tick and a cross speak for themselves on screen; every other status also writes its word on the trailing edge, hidden from screen readers, which already hear it. Use `failed` for a test that ran and did not get what it expects, and `error` for one that could not run at all, such as a test with a broken setup. A `stale` row keeps its last result's reason and figure: the result is still worth reading, but what it tested has changed since.

The list lays out its rows by its own width, so give it the full width of its column. When the list is narrower than 32rem, for example in a phone sheet, the status's word and the figure move to one line under the reason, so a long name keeps the width to wrap in.

Leave `meta` out while a test waits or runs. The status's word takes its place then, so the row keeps its height from waiting to its result. When a status changes, its glyph fades in and the row does not move; reduced motion shows the new glyph at once.

`TestStatusIcon`, `TEST_STATUS` and `useTestStatusLabel()` give other surfaces the same glyphs, colours and words. The icon is decorative unless you pass `label`.

## Run the tests and say so

<Demo name="test-results/running" />

Choose **Run all** to watch a run. `status="running"` marks the list busy while its rows say which test runs; with no rows yet, the list says "Running the tests…". `status="failed"` says the run did not finish, above whatever the list still shows. Replace that sentence with `failedMessage`, and "No tests" with `emptyMessage`.

`TestCountButton` is the toggle of a tests panel: a flask, **Tests**, and the number of tests that passed, failed and couldn't run, each with its glyph. A status with none is left out. The button's accessible name says the counts in words, such as "Tests: 2 passed, 1 failed". While `status` is `running` the flask turns into a spinner of the same size and the last counts stay, so the button keeps its width and the toolbar around it does not shift. With `failed` an alert glyph takes the flask's place. Pass `expanded` and `controls` for the panel it opens. A changed count pops once; reduced motion keeps it still.

`TestRunAnnouncer` tells screen readers about a run through a visually hidden polite status region. It says "Running 3 tests…" once when a new `announceKey` starts running, and the result once when that key settles, such as "2 passed, 1 failed". It never speaks for the key it mounts with, and it leaves a failed run to your own message. Change the key for each run, never for each finished test. Add `context` when the result answers something, such as "Saved version 4".

`countTestStatuses(statuses)` counts a list of statuses; running and waiting tests count only in `total`. `formatTestCounts(t, counts, locale)` returns the counts as text: "2 passed, 1 failed", "3 not run yet" or "No tests". It takes any translate function and reads its own keys from the `testResults` namespace. Each part has its own message and plural, and the parts are joined the way the reader's language lists them.

## Say what the tests cover

<Demo name="test-results/coverage" />

`TestCoverage` says how many of a document's paths its tests go down: "Covers 2 of 3 paths", beside a meter with a segment per path, or a single bar beyond twelve paths. The words are the content; the meter repeats them for the eye and is hidden from screen readers. Pass `onActivate` to make it a button that takes the reader to your list of paths, as the first one in the example does. Replace the words with `label`. With no paths it renders nothing.

## Props

`TestResultList`:

| Prop                            | Type or default                     | Purpose                                 |
| ------------------------------- | ----------------------------------- | --------------------------------------- |
| `items`                         | `TestResultItem[]`                  | The results, in the order to show them. |
| `onActivate`                    | Optional `(item) => void`           | Makes rows buttons.                     |
| `activeId`                      | Optional string                     | The row the host is showing.            |
| `renderActions`                 | Optional `(item, row) => ReactNode` | Controls beside each row.               |
| `status`                        | `ready`                             | `running` or `failed`, described above. |
| `failedMessage`, `emptyMessage` | Optional React content              | Replace the default sentences.          |
| `density`                       | `comfortable`                       | `compact` leaves the badges out.        |
| `aria-label`, `aria-labelledby` | Optional                            | Names the list.                         |

A `ref` on `TestResultList` gets `focus(id?)`, which focuses the row of `id`, or the current row. Use it to move focus into a panel you have just opened from the keyboard.

`TestCountButton` takes `counts`, `status` (`idle`, `running` or `failed`), `expanded`, `controls`, `onClick` and `size` (`sm` or `default`). `TestRunAnnouncer` takes `counts`, `status`, `announceKey` and `context`. `TestCoverage` takes `covered`, `total`, `label` and `onActivate`.
