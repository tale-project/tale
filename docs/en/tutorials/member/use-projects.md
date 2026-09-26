---
title: Use a project for shared context
description: Create a project, add reference files and instructions, then ask a question that uses the project’s knowledge.
---

Create a project when several chats need the same reference material. In this walkthrough, you will set up a small workspace, add a file, and check that a chat inside the project can use it. Allow about ten minutes, plus the time needed to index your file.

## Before you begin

You need the **Member** role or higher and a short text document, PDF with selectable text, or modern Office file. Choose a file whose contents you can verify, such as a project brief with a named owner and a review date. An admin must have configured document storage and an embedding model for searchable uploads.

New projects are **Org-wide**. Use non-sensitive material for this walkthrough; if the real project needs restricted access, set its owning team under **General > Sharing** before uploading its files. Project chats remain personal until you share them.

## Create the project

1. In Home, click **New project**, the folder icon beside **Projects**.
2. Set **Project name** to a recognizable name, such as `Website relaunch`.
3. Check **Project key**, the short prefix used in task identifiers such as `WEB-1`. It cannot be changed after creation.
4. Add an optional **Description** and click **Create project**.

The new project opens on **Tasks** and appears under **Projects** in Home. The project's navigation also includes **General**, **Chats**, **Knowledge**, and **Agents**. You do not need to create an agent to use project chat.

## Upload a reference file

Open **Knowledge** in the project and click **Add file**, or drop your file onto the upload area. The file appears in the project’s file tree. Wait for **Indexed** before relying on search; **Queued** and **Indexing…** mean the file is still being prepared.

<Frame caption="The Knowledge tab keeps reference files inside the project; the status beside each file shows whether it is searchable.">

![The Website relaunch project’s Knowledge tab lists two indexed files and offers controls to add files and folders.](/images/platform/project-knowledge-files.webp)

</Frame>

A file uploaded here belongs to this project. To ask about it, use a chat inside the project. The organization’s general chat does not search project files.

## Add instructions that apply to every project chat

Open **General**, find **Instructions**, and describe the context or constraints that every chat should follow. For example:

> Use the project files when answering questions about this launch. Cite the source for dates and decisions. If a launch date has not been approved, say that it is unconfirmed.

Click **Save** in the page header. The instructions are part of the project’s chat context; they do not replace the need to upload and retrieve the underlying documents.

<Frame caption="Instructions live on General, alongside the project’s name and description.">

![The General tab contains the project name, description, Instructions editor, and Sharing section, with Save and Discard in the header.](/images/platform/project-general-tab.webp)

</Frame>

## Ask a question and check the source

Open **Chats** and click **New chat**. Leave the model on **Auto** when it is available, then ask a question that your file answers. For a launch brief, try:

> Read the launch brief. Who owns the review, and which dates are confirmed? Cite the file and distinguish confirmed dates from open decisions.

Check the search and reading steps above the reply, then compare the answer with the file. A fluent reply without a supporting source is not proof that Tale used your document. Reopen **Knowledge** to inspect the original when necessary.

<Tip>

Name the document and the specific question. “Which review date is confirmed in the launch brief?” gives the assistant a clearer retrieval target than “Tell me about the project.”

</Tip>

## Share the useful conversation

The **Chats** tab separates **Your chats** from **Shared with project**. Enable **Share with project** on a chat when the people who can access this project should be able to read it. Uploading project files does not share your chats automatically.

For a one-off link to a snapshot for organization members, follow [Shared chats](/platform/chat/shared-threads). Check the transcript before sharing: its text may contain details from sources with a narrower audience.

## If the file is missing from the answer

| What you see | What to check |
| --- | --- |
| Upload fails before a row appears | Retry with a small supported file. If that also fails, ask an admin to check document storage and the upload policy. |
| **Queued** or **Indexing…** | Let processing finish, then ask again. |
| **Failed** | Use **Retry indexing**. If the failure returns, ask an admin to check the embedding model and knowledge service. |
| **Not indexed** | Use **Index now** when offered. Convert a legacy Office file to its modern format if it has no supported text extractor. |
| **Indexed**, but the reply has no relevant source | Confirm the chat belongs to this project, name the file, and ask for one specific fact. Verify the result against the original. |

You now have a reusable place for the project’s sources and conversations. Add work to its [task board](/platform/projects/tasks) when it needs an owner, a due date, or a reviewable result.
