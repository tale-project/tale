---
title: Compare models in Arena
description: Send one prompt to two models, assess both replies and choose how to continue the conversation.
---

Use **Arena Mode** to compare two models on the same prompt. Both sides use the chat assistant and the same starting context. Choose a question you can evaluate: preference alone cannot establish that an answer is correct.

## Start a comparison

Open a private chat, open the composer’s **+** menu and select **Arena Mode**. Shared chats cannot enter Arena. Choose the models under **Model A** and **Model B**, then send your prompt. You may choose the same model twice to compare variation, or two different models to compare their behavior.

For a useful first comparison, give both sides a short source and a precise request, such as “List the three decisions in these meeting notes and cite the sentence supporting each.” Keep the source, instructions and requested format the same.

<Frame caption="The same prompt answered by two models, with the verdict row beneath.">

![Arena Mode with one launch-checklist prompt answered in two columns — Claude Haiku 4.5 on the left returning a numbered five-step list, Claude Sonnet 4.6 on the right grouping the same work under headings and adding the risks worth flagging — above the A is better, B is better, Tie, and Both bad verdict buttons.](/images/platform/chat-arena-split.webp)

</Frame>

Each reply appears in its own column. The prompt is admitted for both columns together: a usage limit that would stop it stops it for both sides, never for one column alone. Wait until both have finished before selecting a verdict; the controls stay unavailable while either side is answering. A slow reply is still part of the comparison. If a side fails, its column shows the error and the round cannot be judged: the four verdict buttons stay unavailable until both columns hold a finished reply, while **Exit without verdict** remains available. Inspect the error before treating the result as a quality judgment.

## Judge the replies

Check factual accuracy against the source, whether the reply followed the instructions, whether essential details are missing, and how much editing you would need before using it. A longer or more confident response is not necessarily better.

| Verdict | Use it when | Conversation continues with |
| --- | --- | --- |
| **A is better** | A is more useful or accurate. | Column A. |
| **B is better** | B is more useful or accurate. | Column B. |
| **Tie** | Both meet the request equally well. | Column A. |
| **Both bad** | Neither is acceptable. | Column A. |
| **Exit without verdict** | You do not want to record a comparison. | Column A, without a verdict. |

Every choice ends the two-column comparison. The next message goes to the remaining conversation. To compare again, enable Arena again; a tie does not keep both columns active.

## Find the recorded feedback

When both models have produced replies, a verdict contributes to the organization’s [Feedback analytics](/platform/admin/governance/feedback-analytics). Administrators can inspect **Arena verdicts** and model matchups there. A round in which only one column answered is never recorded: the verdict is refused, so the analytics only contain comparisons of two finished replies. Exiting without a verdict does not add a rating.

Use several representative questions before drawing a conclusion about a model. A result for a short summary may not predict its performance on code or long documents, and organization-wide preferences include other people’s tasks.

## Resolve a blocked comparison

If a model is absent, check its provider and access rules through the [model catalog](/platform/models). If the verdict buttons remain disabled, wait for both generations to end, or check that both columns show a finished reply: a side that failed or never answered leaves nothing to compare, so exit without a verdict, fix the cause and send the prompt again. A failed request may reflect credentials, availability or policy rather than answer quality; use its displayed reason to decide what to fix before retrying.
