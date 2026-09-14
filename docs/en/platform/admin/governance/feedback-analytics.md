---
title: Feedback analytics
description: Compare chat ratings and arena verdicts, read comments, and investigate changes in answer quality.
---

Use **Settings > Metrics > Feedback** as an Admin or Owner to review the feedback members submit in chat. Ratings tell you what people judged useful; their comments help explain why.

## Find the feedback you need

Choose a period, then narrow by feedback type, assistant, or model. The available windows are 1, 7, 30, and 90 days, plus all time; the initial view uses 7 days. Selecting an assistant or model in a breakdown filters the view. Clear the filter chips to broaden it again.

Use **Comments only** to focus on written explanations. If no feedback appears, check the period and filters before concluding that nobody has rated a reply. Feedback is voluntary; an unrated answer is neither a positive nor a negative vote.

## Keep the signals separate

| Signal | What it tells you |
| --- | --- |
| Thumbs up/down | Whether a member found a particular reply helpful. An optional comment provides context. |
| Arena verdict | Which answer a member preferred in a specific pair, or whether the pair tied or both were bad. |

Members can change or withdraw a rating. The dashboard reflects the current state, not a permanent count of every click. [Arena mode](/platform/chat/arena-mode) explains how members compare two answers.

## Compare results fairly

Read the number of ratings alongside the helpful ratio. One positive vote is weaker evidence than repeated feedback across the tasks a model actually handles. Compare similar periods and tasks before attributing a change to a model or an assistant configuration.

Use the assistant and model tables to locate the change, the trend to find its timing, and **Recent feedback** to read comments. For arena results, compare the same model pairing; a win against one model does not establish superiority over every model.

<Tip>
Pair this review with [usage analytics](/platform/admin/governance/usage-analytics). A model can cost less per request while requiring more retries to produce a useful answer.
</Tip>

## Understand partial results

Large windows can reach the aggregation limit of 50,000 entries. If Tale shows a partial-results notice, narrow the period before drawing conclusions. Retention and deletion also affect which ratings and comments remain available; this view is not a permanent archive of member feedback.
