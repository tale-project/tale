---
title: Arena Mode
description: Side-by-side model comparison inside Chat — how it renders, how to pick the contenders, how verdicts feed feedback analytics, and when to reach for it.
---

Arena Mode runs the same prompt against two models at once and asks you which reply is better. The verdict feeds the org's feedback analytics; over time, the data tells which model the team actually prefers for which kind of question, separate from anyone's gut feel.

Reach for Arena when picking a model has been a debate rather than a decision — comparing replies side by side breaks the deadlock with evidence rather than opinions. For ordinary work the regular model picker is enough; Arena's value is the verdicts it produces, not the comparison view itself.

## How Arena renders

Open the chat's plus menu and pick **Arena Mode** — the chat sprouts two model pickers labelled **Model A** and **Model B**. Sending a message runs both models in parallel; the screen splits and each reply streams into its own column. Once both finish, a verdict row appears under the columns with four buttons: **A is better**, **B is better**, **Tie**, **Both bad**.

<Frame caption="The same prompt answered by two models, with the verdict row beneath.">

![Arena Mode with one launch-checklist prompt answered in two columns — Claude Haiku 4.5 on the left returning a numbered five-step list, Claude Sonnet 4.6 on the right grouping the same work under headings and adding the risks worth flagging — above the A is better, B is better, Tie, and Both bad verdict buttons.](/images/platform/chat-arena-split.webp)

</Frame>

<Note>

Both columns run the same chat assistant, so the instructions, tools, and knowledge on each side are identical and only the model differs — which is the whole point of the comparison.

</Note>

## Picking the contenders

The two pickers are independent — any model your organisation makes available is fair game on each side. Picking the same model on both sides is allowed, but most comparisons span vendors or sizes. The assistant's instructions, knowledge, and tools apply to both columns; only the underlying model differs.

## Casting a verdict

The verdict is single-click. **A is better** and **B is better** are self-explanatory; **Tie** is for when both replies are roughly equally good; **Both bad** is for when neither is acceptable. The button you click records the verdict and resolves the chat to the winning column — the next message you send goes to that model only. Picking **Tie** or **Both bad** leaves both columns active for one more round.

## Where verdicts surface

Verdicts roll up into [Feedback analytics](/platform/admin/governance/feedback-analytics) under **Arena verdicts**, alongside a **Top Model Matchups** table that ranks pairings by win rate. The data is org-scoped rather than per-user, so a handful of deliberate verdicts can outweigh a much larger pile of habit when someone reads the table to decide which model the team should reach for.

## When to reach for it

| Use … when                                                 | Arena Mode | Regular model picker |
| ---------------------------------------------------------- | ---------- | -------------------- |
| You are deciding which model to default to                 | ✓          |                      |
| You suspect a model regression after an upgrade            | ✓          |                      |
| You already know which model you want and need a reply now |            | ✓                    |
| The query is short and ordinary                            |            | ✓                    |

## Where this fits

Arena is the lightweight feedback loop on top of model choice. The heavier surface is [Feedback analytics](/platform/admin/governance/feedback-analytics) — that is where the verdicts you cast become a chart someone uses to argue about defaults. If you are the one who will read the chart later, run a handful of Arena rounds before reading the chart; the verdicts you cast yourself will tell you whether the table's framing matches your experience.
