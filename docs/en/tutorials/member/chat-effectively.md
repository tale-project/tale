---
title: Get a useful answer from chat
description: Practice asking a focused question, checking a citation, and improving the answer with a follow-up.
---

A useful chat answer starts with a clear question and ends with a source check. In this exercise, use a short document you are allowed to upload, ask about a fact in it, then test whether the assistant distinguishes what the document says from what it leaves open.

You need access to Chat and an available model. For document questions, your organization also needs working knowledge indexing. If you already have a suitable indexed document, you can use it instead of the example.

## Prepare a small source

Save this text as `launch-brief.txt` on your device:

```text
Website relaunch brief
The customer review is on 18 September 2026.
Maya Chen owns the review checklist.
The launch date has not been approved.
The review must cover accessibility, redirects, and the contact form.
```

Open a new chat and attach the file through **Add photos & files** in the composer menu. Wait until uploading and indexing have finished before asking about its text. [Chat attachments](/platform/chat/attachments) explains the status shown on the attachment.

## Ask for a specific result

Send:

```text
Using launch-brief.txt, list the review date, the checklist owner, and the
three review topics. Cite the source. Keep the answer to four bullets.
```

The request names the source, the facts you need, and the output shape. It is easier to evaluate than “Tell me about the launch.” **Auto** is a reasonable starting point; choose a model explicitly when you need to compare its behavior with another one.

<Frame caption="Keep the question visible while checking whether the answer meets it.">

![A chat shows a focused question about onboarding feedback and a response organized into a table.](/images/platform/chat-thread-reply.webp)

</Frame>

## Check the answer against the file

The review date should be **18 September 2026**, the owner **Maya Chen**, and the topics **accessibility, redirects, and the contact form**. Open the cited source and compare those values. Formatting can vary; the facts should not.

If the answer lacks a source, ask it to cite the document rather than assuming the attached file was read. If it cannot find the content, check the attachment's indexing state and retry after it is ready. A fluent answer is not evidence of retrieval.

## Ask a follow-up that exposes uncertainty

In the same conversation, ask:

```text
What is the approved launch date? If the brief does not give one, say so.
```

The source does **not** give an approved launch date. A good answer preserves that distinction instead of using the review date as the launch date. When an answer makes an unsupported assumption, point to the conflicting sentence and request a correction.

<Tip>

Change one part of the request at a time. “Make it shorter” tests length; “separate confirmed dates from open decisions” tests interpretation. Changing the source, model, question, and format together makes it difficult to see what improved the result.

</Tip>

## Keep the useful context

Continue the same chat for related questions. Start a new one for an unrelated topic so old assumptions do not distract from the new task. If several conversations need this brief, put it in a [project](/tutorials/member/use-projects) and use project chat.

Before [sharing a chat](/platform/chat/shared-threads), read the messages and any source excerpts in the answer. If the next step is producing a deliverable that needs an owner and review, create a [project task](/platform/projects/tasks) with the verified facts and acceptance criteria.
