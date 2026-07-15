# Discussions — Manual Test Plan

> **Purpose**: Project Discussions are a multi-party thread (teammates + agents)
> rendered as chat bubbles. This plan exercises author-aware alignment, author
> name labels, and the teammate/agent `@`-mention picker in the reply box.
> Needs a project with at least two members and one project agent.

## Scope & routes

| Surface           | Route                                                          |
| ----------------- | -------------------------------------------------------------- |
| Discussions list  | `/dashboard/{org}/projects/{projectId}/discussions`            |
| Discussion thread | `/dashboard/{org}/projects/{projectId}/discussions` (open one) |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Create (or open) a
project that has **two members** (so you can post as one and view as the other)
and **one enabled agent** on the **Agents & models** tab. Open the **Discussions**
tab and open or create a discussion.

> **Agent note**: a reply reaches a terminal state when the reply box re-enables
> after Send; an agent reply lands as a new left-aligned bubble — wait on the
> bubble appearing, not on any text. Locate the reply box by its placeholder
> (`discussions.reply.placeholder`) and bubbles by their visible text.

## Automated coverage

| Case(s) | Status         | e2e spec                                                                                                                 |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F1–F3   | 🔶 partial     | unit: `discussions/lib/resolve-author.test.ts`, component: `chat/components/message-bubble.test.tsx` (alignment + label) |
| F4–F5   | ⛔ manual-only | —                                                                                                                        |
| F6      | ⛔ manual-only | —                                                                                                                        |
| B1–B3   | ⛔ manual-only | —                                                                                                                        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                                    | Steps (route + control)                                                     | Expected (verifiable)                                                                                                           |
| --- | --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Own replies right-align                 | Post a reply via the reply box (`discussions.reply.placeholder`) → **Send** | Your bubble is right-aligned with **no** name label above it                                                                    |
| F2  | Teammate replies left-align with a name | Sign in as the second member, open the same discussion                      | The first member's reply is **left-aligned** with their **display name** shown above the bubble                                 |
| F3  | Agent reply attributed                  | `@mention` an agent in a reply and send (see F4)                            | The agent's reply lands **left-aligned** with the **agent's name** above it, body streams/renders markdown                      |
| F4  | Mention picker opens + inserts          | Type `@` then a letter in the reply box                                     | A picker (`tasks.mentionPicker.title`) lists teammates + agents; ↑/↓ navigate, Enter/click inserts `@handle ` into the textarea |
| F5  | Mention triggers the agent              | Send a reply containing the inserted `@agent` handle                        | A new agent reply bubble appears in the thread (left, attributed)                                                               |
| F6  | Opening post attribution                | Open a human-created discussion                                             | The opening post shows its author's name and aligns by who you are (right if you created it, else left)                         |

## Boundary & error tests

| ID  | Test                    | Input                                                         | Expected                                                                                                                                                                                                                 |
| --- | ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Legacy message degrades | Open a discussion created **before** this change              | Old messages still render: your old replies right, others left, **no** name label — nothing crashes or mis-aligns to a single side                                                                                       |
| B2  | Locked discussion       | Lock the discussion (`discussions.lock`), focus the reply box | The reply box is disabled (`discussions.reply.lockedPlaceholder`); `@` does nothing                                                                                                                                      |
| B3  | No matches              | Type `@zzzz` (no such actor)                                  | Picker shows the empty state **No matches** (`tasks.mentionPicker.empty`); Enter inserts no handle — but it falls through to Send and posts the literal text (clear the reply box to avoid a stray reply; see Issues #1) |

## Accessibility (WCAG 2.1 AA)

| ID  | Check                       | Expected                                                                                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Author label readable       | The name label has sufficient contrast and is in DOM source order before its bubble (SR reads "name, then message")                |
| A2  | Mention picker is a listbox | The picker is `role="listbox"`; the textarea exposes `aria-expanded`/`aria-activedescendant`; ↑/↓/Enter/Esc work from the keyboard |

## Performance

| ID  | Metric              | Target                                                                                                          |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| P1  | Picker open latency | `@`-typing shows the picker with no perceptible delay (actor list is client-side, already loaded by the thread) |

## Issues Found

| #   | Test ID | Route / URL                                         | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                           | Screenshot |
| --- | ------- | --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | B3      | `/dashboard/{org}/projects/{projectId}/discussions` | low                          | With the mention picker open on "No matches", Enter is not captured — it falls through to the reply box's send and posts the literal `@zzzz` as a reply. Users likely expect Enter to dismiss the empty picker, not publish the typo. | —          |

## Test summary

```
Area: Discussions
Functional: ___/6   Boundary: ___/3   A11y: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
