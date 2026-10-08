---
title: Issue list
description: List problems a check found in the reader's words, take the reader to each one, and count and announce the result.
---

`IssueList` shows the problems a check found: what is wrong, where, why and how to fix it. Use it for validation results, a refused save, or a check that ran in the background. The list displays what the host gives it; it does not check anything itself.

```tsx
import { IssueDetail, IssueList, type IssueItem } from '@tale/ui/issue-list';
import { IssueAnnouncer, IssueCountButton, formatIssueCounts } from '@tale/ui/issue-summary';
import { IssueSeverityIcon } from '@tale/ui/issue-severity';
```

## Take the reader to a problem

<Demo name="issue-list/basic" />

Pass `onActivate` and every row becomes a button. Choose a row and the example records where it went; in an application, `onActivate` selects the part that holds the problem and moves focus to the field to fix, usually through [`useRequestIssueFocus`](/docs/components/field-issues). Pass the id of the row you went to as `activeId`, so the list marks it with `aria-current` and keyboard focus starts there next time.

The list is a single tab stop. Up and Down move between rows, Home and End jump to the first and last, and Enter or Space activates the row. A row's **Technical details** and **Learn more** join the tab order only while that row is the current one, so Tab moves from the row through its own details and then out of the list. **Go to** appears beside the code on hover and keyboard focus.

When you cannot take the reader to a problem, for example because the editor has no control for that part, set `unavailableReason`. The row stays focusable and readable, says the reason on the row itself, and ignores activation. The reason is not a tooltip, because a tooltip never appears on a touch screen.

## Write each problem for the reader

| Field | What it holds |
| --- | --- |
| `id` | Stable across checks, so focus and the current row survive a re-check. |
| `severity` | `error`, `warning` or `info`. |
| `title` | Short and specific: what is wrong. |
| `location` | Where it is, such as "Draft reply › Prompt". It wraps rather than truncates. |
| `explanation` | What this kind of problem means. Muted. |
| `cause` | This problem's concrete case. |
| `fix` | What to do, after a **How to fix:** label. |
| `code` | A stable code in small monospace, for search and support. |
| `technical` | Raw detail such as an engine message, folded under **Technical details**. |
| `docsHref` | Opens **Learn more** in a new tab. |
| `unavailableReason` | Why going to this problem is not possible here. |

Translate every field before you pass it in; the list adds only its own labels, from the package's `issues` catalog. Severity never relies on colour: each row has the severity's icon (a crossed circle, a warning triangle, an info circle) and a visually hidden "Error:", "Warning:" or "Note:" before the title. The row's accessible name is the severity, title and location; its description is the explanation and cause. Only the error icon is red and only the warning icon is amber. Warning text stays in the foreground colour, because amber text does not reach AA contrast on a light surface.

`IssueSeverityIcon`, `ISSUE_SEVERITY_ICON` and `ISSUE_SEVERITY_ICON_CLASS` from `@tale/ui/issue-severity` give other surfaces the same glyphs and colours. The icon is decorative unless you pass `label`.

## Show checking, failure and nothing to fix

<Demo name="issue-list/states" />

Choose a state to see the count button and the list together. `status` tells the list what the rows belong to:

| `status` | The list |
| --- | --- |
| `ready` | Shows the result. |
| `checking` | Dims the rows and marks the list busy while a newer result is on its way. |
| `stale` | Dims the rows: they belong to an older draft and a newer check is about to start. |
| `failed` | Says the check did not finish, above whatever it still lists, at full contrast. Replace the sentence with `failedMessage`. |

The dimmed states are meant to last a moment. If a result can stay out of date for longer, say so in words with `failed` and a `failedMessage`. An empty list says "No problems"; replace it with `emptyMessage`. Give `viewKey` the name of the current filter, and a new key fades the rows in, so a filter change reads as a different list rather than a flicker.

## Count and announce the result

`IssueCountButton` is the toggle of a problems panel. It shows a red count and an amber count, "No problems" when both are zero, a spinner beside the last counts while `status` is `checking`, and "Couldn't check" when it is `failed`. Its accessible name says the counts in words, such as "Problems: 2 errors and 1 warning". Pass `expanded` and `controls` for the panel it opens. A changed count pops once, the same way `CountBadge` does; reduced motion keeps it still.

`IssueAnnouncer` speaks a settled result to screen readers through a visually hidden polite status region. It speaks once for each new `announceKey` while `status` is `ready`, and never for the key it mounts with. Key it by finished check rather than by keystroke. Add `context` when the result answers something, such as "Saving was refused". Mount one announcer per surface and let it be the only thing that announces the result; the field messages and the list do not announce themselves.

`formatIssueCounts(t, counts)` returns the same phrase as text. It takes any translate function and reads its own keys from the `issues` namespace. Each language has one message for the whole phrase, so word order and plurals stay the translator's.

## List problems without going anywhere

<Demo name="issue-list/static" />

Without `onActivate` the list is static: rows are text, with no roving focus, and **Technical details** and **Learn more** stay in the normal tab order. Use it in a read-only view, on a run page, or for the problems of one part shown beside that part. `density="compact"` keeps the title, location and fix. Name a list with `aria-label` or `aria-labelledby`; without either it is called "Problems".

`IssueDetail` renders the explanation, cause, fix, technical details and link of one problem on its own, with `actions` for your own buttons after them. It is indented to the list's title column; pass `className` to align it elsewhere.

## Props

| Prop | Type or default | Purpose |
| --- | --- | --- |
| `issues` | `IssueItem[]` | The problems, in the order to show them. |
| `onActivate` | Optional `(issue) => void` | Makes rows buttons that go to a problem. |
| `activeId` | Optional string | The row the host is showing. |
| `density` | `comfortable` | `compact` shows title, location and fix. |
| `status` | `ready` | `checking`, `stale` or `failed`, described above. |
| `failedMessage`, `emptyMessage` | Optional React content | Replace the default sentences. |
| `viewKey` | Optional string | A new value fades the rows in. |
| `aria-label`, `aria-labelledby` | Optional | Names the list. |

A `ref` on `IssueList` gets `focus(id?)`, which focuses the row of `id`, or the current row. Use it to move focus into a panel you have just opened from the keyboard.
