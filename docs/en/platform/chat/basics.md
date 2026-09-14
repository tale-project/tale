---
title: Ask questions in chat
description: Send a message, choose a model, check the answer’s sources, and keep a useful conversation.
---

Use chat to ask questions, understand a document, or investigate information in Tale. The assistant can search accessible knowledge and read public pages. Start with a specific question, then use follow-up messages to narrow the answer.

<Frame caption="The conversation keeps your question, the assistant’s steps, and its reply together.">

![A chat about onboarding feedback shows the question and an assistant reply with three themes in a table.](/images/platform/chat-thread-reply.webp)

</Frame>

## Send your first message

Open **Chat**. It may reopen a recent conversation. Choose **New chat**, or choose **Chat** again while it is active, to begin a new subject. Type in the message field. Press **Enter** to send or **Shift+Enter** for a new line. A starter prompt fills the same role as your own first question; edit your request to include the source, subject, and kind of answer you need.

For example: “Find the onboarding feedback and summarize the three most common problems. Cite the documents and separate reported problems from your suggestions.”

While the reply streams, the send control becomes a stop control. Stopping keeps the text already received, which may end mid-sentence. Use a follow-up message to clarify the question or ask for missing detail.

## Choose a model when the choice matters

The model picker starts on **Auto** when several usable models are available. Auto selects a model for each message from your organization’s available models; organization rules can set a default or restrict the choices. The details under a reply identify the model that actually answered.

Pick a named model when you need consistent comparisons or know which model the work requires. Your choice stays selected until you change it. If that model supports adjustable reasoning, the picker also offers an effort setting. More reasoning can take longer; it is not a substitute for checking the answer.

<Frame caption="The model picker sits beside the attachment menu and voice controls.">

![The chat composer contains the plus menu, an Auto model picker, a microphone, and the send button.](/images/platform/chat-composer.webp)

</Frame>

If no models are available, ask an admin to check active provider credentials and model access. [Models](/platform/models) explains how the catalog is built.

## Give the assistant the right sources

Choose the conversation’s location before asking about files:

| Where you ask | Files the assistant can retrieve |
| --- | --- |
| The organization’s chat | Knowledge-library documents you can access and this chat’s own attachments. |
| A chat inside a project | That project’s files, Knowledge-library documents you can access, and the chat’s own attachments. |
| A shared chat link | A read-only snapshot; viewers cannot ask follow-up questions there. |

Project chat also receives the project’s standing instructions. File access is enforced by Tale, so asking a project chat to read a different project does not grant access. Trashed or expired files are not searchable.

Use [attachments](/platform/chat/attachments) for material needed in this conversation, [project files](/platform/projects/manage-files) for recurring project work, and [Knowledge](/platform/knowledge/overview) for shared reference material. The assistant retrieves content when it needs it; uploading a document does not mean every answer has read it.

## Check what the assistant used

Above the reply, the timeline shows search and reading steps. A failed step explains what could not be read; it is useful evidence when an answer is incomplete. Expand the thinking section when one is available, but judge factual claims against sources rather than the fluency of that explanation.

**Sources** below the answer lists documents and pages the assistant loaded. Open a source and check that it supports the relevant claim. A citation establishes which material was used, not that every conclusion is correct. A reply without a retrieval step may rely on the model’s prior knowledge.

The assistant can search workspace information such as documents, knowledge entries, websites, contacts, products, and accessible tasks. It can fetch the details behind a result and read a public web page. Chat does not run code, change connected systems, or produce file deliverables; assign that work to a [project task](/platform/projects/tasks).

## Continue, copy, or keep the conversation

Use the reply toolbar to copy an answer, give feedback, inspect its details, or fork a conversation at that point. A fork lets you try another direction while preserving the earlier exchange.

Find earlier chats in the sidebar. Pin frequently used chats, give a chat a recognizable title, or move it into a project when the topic becomes ongoing work. [Shared chats](/platform/chat/shared-threads) explains how to publish a read-only snapshot for colleagues.

Very long conversations may exceed the model’s context window. Tale displays a notice when older messages are omitted. Restate an important requirement or start a new chat with the relevant sources instead of assuming the assistant still sees the entire history.

## Improve an incomplete answer

| Problem | Try this |
| --- | --- |
| The answer is too broad | Ask one question, name the audience, and specify the desired length or format. |
| A file was not used | Check the chat’s project, the file’s indexing status, and the retrieval steps. Name the file explicitly. |
| Search reports an unavailable source | Ask an admin to check the named service or embedding configuration; an empty result is not proof the information does not exist. |
| A reply stops with an error | Read its error, check the selected model, and retry after the cause is resolved. Tale does not silently switch providers. |

For a guided example with source checking, follow [Chat effectively](/tutorials/member/chat-effectively).
