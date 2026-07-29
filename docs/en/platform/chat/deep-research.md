---
title: Deep research
description: The Researcher agent — open-ended web research with a live to-do plan, cited sources via Tavily, and a clean PDF report at the end.
---

Deep research is a chat mode that hands a question to a specialised **Researcher** agent. The agent plans the work as a list of sub-questions, searches the open web with Tavily, reads the most promising pages, tracks progress in a to-do card you can watch in real time, and finishes with a PDF report that cites every source it used. Reach for it when the question is open-ended, the answer needs evidence, and you would otherwise spend an hour with twenty browser tabs.

This page covers the Deep research surface end to end — when to pick it, what the flow looks like, the budget that keeps it from running forever, and where the cited sources come from. The agent's mechanic is the same shape as every other Tale agent (see [Agent concepts](/platform/agents/concepts)); what is unusual here is the live to-do plan and the Tavily connector that drives the searches.

## When to reach for it

Deep research beats a plain chat for questions where the value is not the model's existing knowledge but the assembly of recent, sourced information. Three signals it is the right mode:

- The question is open-ended ("what is the current consensus on…", "compare the top three…").
- You want citations — a quote without a URL is a guess.
- You are happy to wait two to ten minutes for a written report instead of a chat reply.

For narrow factual questions ("what is the capital of Senegal") plain chat is faster and every bit as accurate. For questions about your own data ("what did the contact say in last Tuesday's call") an agent with [Knowledge](/platform/agents/knowledge) bindings is the right shape — Deep research only reads the open web, not your knowledge base.

## Open Deep research

Open the composer's plus menu — modes live under its **Modes** header, and **Deep research** appears there once the Researcher agent is available. Pick it and the chat switches into the Researcher agent. Type the question and send. The reply pane changes from the usual streaming text to a **research plan** card with three to seven to-do items the agent has chosen as sub-questions.

The mode is available when an Editor or above has bound the **Tavily** connector under [Settings > Connectors](/platform/connectors/overview); without Tavily, the menu entry names the missing connector and clicking it opens the connector settings.

## The research plan

The plan is a list of `pending` to-do items the agent generated from your question. For complex questions the agent pauses after the first plan and asks you to confirm — a **Proceed with this plan?** card appears with a yes/no field. Click yes to start; click no and the agent does not run further. Trivial questions skip the confirmation.

Once running, the agent works the to-dos one at a time:

1. Sets the current to-do to `in_progress`.
2. Searches Tavily up to three times for that to-do.
3. Reads up to two of the most promising URLs in full via Tavily's extract operation.
4. Sets the to-do to `done` with a one-sentence finding.

The card updates live as each step lands. You can watch the model's reasoning shape itself; if a new sub-question surfaces mid-run, the agent adds it to the list.

## Searches and extracts

Tavily is the open-web search provider behind Deep research — its API is optimised for LLM agents and returns search hits with cleaned snippets and per-result scores. Two operations matter:

- **search** — natural-language query with depth (`basic` or `advanced`), topic (`general` or `news`, with a `days` window for recency), and an optional domain allowlist or blocklist.
- **extract** — fetches the cleaned main-article text for one to five URLs. The agent calls this on the two best hits per to-do when a snippet is not enough.

Tavily's free tier is 1000 calls per month; paid plans unlock `advanced` depth on search and the extract operation. The setup steps live on the connector's setup card in **Settings > Connectors**.

## Per-run budget

Deep research caps a run at:

- **3 searches + 2 extracts per to-do.** The connector wrapper rejects calls beyond this.
- **40 reasoning steps total** across the whole run.
- **25 minutes wall-clock.** After that the agent stops and synthesises with whatever it has.
- **60 connector calls total per run** as a hard ceiling.

Hitting any cap stops the search phase and pushes the agent into synthesis. If you need more, run the question again with a tighter scope or break it into two questions.

## The PDF report

When every to-do is `done` (or cancelled, or the budget hit a wall), the agent calls the **pdf** tool once to produce a single structured report:

- **Conclusion** — one to three sentences answering the question directly.
- **Key points** — three to seven bullets, each carrying at least one inline citation to a Tavily source.
- **Details** — the longer analysis grouped by sub-question.
- **Sources** — a deduplicated list of every cited URL.

The PDF arrives as an attachment card in the chat. The agent does not paste the report into the message body — the card is the deliverable. A short confirmation line in your language ("Research complete — see the attached PDF for the full report.") points at the card.

For Chinese, Japanese, and Korean reports the PDF renderer's font set is incomplete; in that case the agent emits the same structured report directly in chat and notes that an English-translated PDF is available on request.

## Failure cases

- **Tavily not connected.** The agent emits a one-liner asking an Editor to connect Tavily in **Settings > Connectors** and stops.
- **Tavily quota exhausted.** The connector returns `CONNECTOR_BUDGET_EXHAUSTED` and the agent moves to synthesis with whatever it has. Free tier hits this around the thousandth call of the month.
- **A specific URL fails to extract.** The relevant to-do is marked `failed` with a reason; other to-dos keep running.
- **Your budget runs out.** The run stops and the agent synthesises. The card shows which to-dos were skipped.

## Where this fits

Deep research is the heaviest end of the chat — it does in ten minutes what an analyst would do in an afternoon. Pair this page with [Agent concepts](/platform/agents/concepts) (the four-knob model the Researcher agent is built on) and [Connectors overview](/platform/connectors/overview) (where Tavily sits alongside the other connectors the agent toolbelt can reach). If you want to build your own research-style agent rather than use the shipped one, [Create an agent](/platform/agents/create) walks the agent build end to end.
