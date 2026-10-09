---
title: Ask questions in chat
description: Send a message, choose a model, check the answer’s sources, and keep a useful conversation.
---

Use chat to ask questions, understand a document, or investigate information in Tale. The assistant can search accessible knowledge and read public pages. Start with a specific question, then use follow-up messages to narrow the answer.

<Frame caption="The conversation keeps your question, the assistant’s steps, and its reply together.">

![A chat about onboarding feedback shows the question and an assistant reply with three themes in a table.](/images/platform/chat-thread-reply.webp)

</Frame>

## Send your first message

Open **Home**. On a computer, a new chat opens, and the Home panel beside it lists your earlier chats; on a phone, choose **Chats**, then **New chat**. To begin another subject later, choose **New chat** or, on a computer, **Home** again. Type in the message field. Press **Enter** to send or **Shift+Enter** for a new line. A starter prompt fills the same role as your own first question; edit your request to include the source, subject, and kind of answer you need.

For example: “Find the onboarding feedback and summarize the three most common problems. Cite the documents and separate reported problems from your suggestions.”

If your organization turned on a confidentiality notice, it appears under the message field as a reminder of what not to share in chat.

While the reply streams, the send control becomes a stop control. Stopping keeps the text already received, which may end mid-sentence. Use a follow-up message to clarify the question or ask for missing detail.

## Choose a model when the choice matters

The model picker starts on **Auto** when several usable models are available. Auto selects a model for each message from your organization’s available models; organization rules can set a default or restrict the choices. The [details under a reply](#reply-details) identify the model that actually answered.

Pick a named model when you need consistent comparisons or know which model the work requires. Your choice stays selected until you change it, including which provider serves the model when two providers offer the same one. If that model supports adjustable reasoning, the picker also offers an effort setting. More reasoning can take longer; it is not a substitute for checking the answer.

<Frame caption="The model picker sits beside the attachment menu and voice controls.">

![The chat composer contains the plus menu, an Auto model picker, a microphone, and the send button.](/images/platform/chat-composer.webp)

</Frame>

If no models are available, ask an admin to check active provider credentials and model access. Chat offers only models that an API key or environment-variable credential serves: a subscription runs only in tasks and automations, and the model list names any it leaves out. [Models](/platform/models) explains how the catalog is built.

## Give the assistant the right sources

Choose the conversation’s location before asking about files:

| Where you ask | Files the assistant can retrieve |
| --- | --- |
| The organization’s chat | Knowledge-library documents you can access and this chat’s own attachments. |
| A chat inside a project | That project’s files, Knowledge-library documents you can access, and the chat’s own attachments. |
| A shared chat link | A read-only snapshot; viewers cannot ask follow-up questions there. |

Project chat also receives the project’s standing instructions. File access is enforced by Tale, so asking a project chat to read a different project does not grant access. Trashed or expired files are not searchable.

Use [attachments](/platform/chat/attachments) for material needed in this conversation, [project files](/platform/projects/manage-files) for recurring project work, and [Knowledge](/platform/knowledge/overview) for shared reference material. The assistant retrieves content when it needs it; uploading a document does not mean every answer has read it.

Questions about Tale itself need no upload: the assistant looks up the public documentation at docs.tale.dev before explaining how a screen or setting works. If the server cannot reach docs.tale.dev, for example on a self-hosted installation without internet access, the timeline shows a failed reading step and the answer is not grounded in the documentation. The documentation describes the latest release, so the assistant points out when your workspace may differ.

## Check what the assistant used

Above the reply, the timeline shows search and reading steps. A failed step explains what could not be read; it is useful evidence when an answer is incomplete. Expand the thinking section when one is available, but judge factual claims against sources rather than the fluency of that explanation.

**Sources** below the answer lists documents and pages the assistant loaded. Open a source and check that it supports the relevant claim. A citation establishes which material was used, not that every conclusion is correct. A reply without a retrieval step may rely on the model’s prior knowledge.

The assistant can search workspace information such as documents, knowledge entries, websites, contacts, products, accessible tasks, and the Inbox conversations you can see, including the text of the emails they received and of their attachments. A task can be named by its key, such as `DOCS-12`, as the board shows it. It can fetch the details behind a result and read a public web page. Chat does not run code, change connected systems, create images, produce file deliverables, or use [skills](/platform/workspace/skills); assign that work to a [project task](/platform/projects/tasks). Any member can create one in a project they can open and hand it to one of the project's agents; [Turn a chat into a task](#create-task-from-chat) shows how to start it from the conversation. A project agent working on the task can create images when an admin has turned on [image generation](/platform/admin/governance/content-models#let-agents-generate-images).

## See how a reply was produced {#reply-details}

Select **Show info** under a reply to open **Message information**. It names the model that answered and its **Provider**, shows how long the reply took and how many tokens it used, and says where it ran when that is known.

- **Time to first token** is how long the model took to start its answer, **Output speed** how fast it wrote in tokens per second, and **Total time** how long the whole reply took. The bar beneath divides that time into preparing, waiting for the model, thinking, and writing. The server measures from when it began the reply, so the wait until the first words reached your screen, shown below the bar, can be longer.
- **Served by** names the company that ran the model when your provider passes requests on. OpenRouter, for example, can serve the same Claude model through Anthropic, Amazon Bedrock, or Google Vertex.
- **Region** says where the reply was processed, but only when the provider reported it, as Azure OpenAI does (for example, Switzerland North), or when the request went to a regional endpoint whose provider commits to processing in one region, such as `eu.openrouter.ai` or `eu.api.openai.com`. Otherwise it reads **Not reported**: Tale does not infer a location from a provider's name or headquarters. On Azure, a Global deployment can process a request in any region, whatever region the response names; a Data Zone deployment processes within its data zone, such as the EU, and a Regional deployment within its geography.
- **Model version** appears when the provider reports a more specific model than the one requested, such as a dated release behind an alias or the model behind an Azure deployment name.

## Turn a chat into a task {#create-task-from-chat}

When a conversation ends in work that needs a file, such as a presentation, a report, or a spreadsheet, hand it to a project agent. Select **Create task** in the conversation's header; on a narrow screen, choose **Create task from chat** in the **⋯** menu. A chat filed in a project creates the task there. Otherwise, choose the project first: **With an agent** lists the projects you can open that have agents, with how many. A project without agents of its own appears there with **Standard agent**: its task goes to the organization's [standard agent](/platform/projects/project-agents#standard-agent). When the standard agent can't run for you, for example because an admin has turned it off, such projects are listed under **No agent yet** instead, each saying who can add one.

The task dialog opens with your last request as the description, a link back to the chat, and the files you attached in the conversation. When the project has a single agent, or uses the standard agent, it's already the **Assignee**; otherwise, choose one. Edit anything you like, then select **Create and start agent**: the task is created, and the agent starts on it at once. **Create only** creates it without starting the agent; **Start agent** on the task starts it later.

<Frame caption="Create task opens the task dialog with the request, a link back to the chat, and the agent to start.">

![The Create task dialog holds the title and description "Plan the quarterly business review agenda for Friday", a link labelled From the chat below the request, Content editor as the assignee, and the buttons Create only and Create and start agent.](/images/platform/chat-create-task.webp)

</Frame>

The task then shows above the chat's message box with what it's doing: **The agent is working**, **Waiting for a sandbox slot**, **Trying again…**, **Ready for review** with the number of files it delivered, or **The agent couldn't finish**. **Open** takes you to the task. You're also notified when it's ready for review and when the agent can't finish; [When the agent can't finish](/platform/projects/task-automation#when-the-agent-cant-finish) explains what to do next.

<Frame caption="The task a chat handed over shows its progress above the message box.">

![Above the message box, a row names the task "Plan the quarterly business review agenda for Friday" with Ready for review · Website relaunch and an Open link.](/images/platform/chat-task-tray.webp)

</Frame>

Ask the assistant for such a file, and it answers what fits in a reply, then walks you through these steps for your own projects, naming the buttons as you see them.

No project you can open offers an agent? Then the standard agent can't run for you: an admin may have turned it off under [Governance > Models](/platform/admin/governance/content-models#standard-agent), or no model you may use can run it. Ask an Admin about it, or ask an Editor or Admin to add an agent on the project's **Agents** tab. As an Editor, you can also add one from the task: under **Assignee**, choose **Create an agent…**.

Files come along only from your own conversation. A task takes only its creator's uploads, so a task created from a chat someone shared into a project starts without them.

## Continue, copy, or keep the conversation

Use the reply toolbar to copy an answer, give feedback, inspect its details, or fork a conversation at that point. A fork lets you try another direction while preserving the earlier exchange.

Your own messages sit on the right. A long one shows its beginning, with **Read more** to open the rest in place and **Show less** to fold it again. Point at one of your messages, or move the keyboard focus into it, to see when you sent it and to use **Edit message**, which changes the text in a new version of the conversation; on a touch screen, both are always shown. Under a message you edited, or one whose reply you asked for again with **Try again**, **Previous branch** and **Next branch** switch between the versions, and the number between them, such as 2/3, says which one is on screen.

Find earlier chats in [Home](/platform#home); **Chats** above the list hides your tasks and inbox conversations. Pin frequently used chats, give a chat a recognizable title, or move it into a project when the topic becomes ongoing work: drag it onto the project or choose **Move to project…** in its menu. [Shared chats](/platform/chat/shared-threads) explains how to publish a read-only snapshot for colleagues.

Very long conversations may exceed the model’s context window. Tale displays a notice when older messages are omitted. Restate an important requirement or start a new chat with the relevant sources instead of assuming the assistant still sees the entire history.

## Improve an incomplete answer

| Problem | Try this |
| --- | --- |
| The answer is too broad | Ask one question, name the audience, and specify the desired length or format. |
| A file was not used | Check the chat’s project, the file’s indexing status, and the retrieval steps. Name the file explicitly. |
| Search reports an unavailable source | Ask an admin to check the named service or embedding configuration; an empty result is not proof the information does not exist. |
| A reply stops with an error | Read its error, check the selected model, and retry after the cause is resolved. Tale does not silently switch providers. |
| A reply ends without an answer | The note in its place says why: the model returned nothing, used up its output token limit before writing, or the provider’s content filter withheld the reply. Select **Try again**, or first lower the reasoning effort, shorten the request, or choose another model. |

For a guided example with source checking, follow [Chat effectively](/tutorials/member/chat-effectively).
