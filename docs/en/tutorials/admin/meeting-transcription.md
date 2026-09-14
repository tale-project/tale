---
title: Make a meeting transcript searchable
description: Import a reviewed transcript into the right project, verify indexing and prepare a repeatable handoff.
---
Turn an exported meeting transcript into a project reference that people can question from chat. Start with one reviewed text file and verify its scope and indexing before automating the delivery. You need permission to edit the target project and a transcript you are authorized to share with its members.

Tale does not include a dedicated Meetily connector or a watched transcript folder. Export from your transcription tool, then use Tale’s supported document upload or API. This guide starts after transcription; it does not record a meeting or configure the transcription tool.

## Prepare the transcript

Export readable text, preferably a `.txt` file for the first test. Check names, speaker attribution, important numbers and decisions against the meeting record. Automated transcripts can mishear the details people later rely on.

Use a recognizable name such as `2026-09-14-project-review.txt`. Include the meeting date, topic and participants in the file. Remove content the project’s members should not receive. Uploading the text does not require uploading the audio.

## Choose who should find it

Upload to the project’s **Knowledge** tab when the transcript belongs to that project. Project membership controls access, and retrieval happens from that project’s chats. Upload to **Knowledge > Documents** only when it should be organization knowledge under the applicable team scope.

Check the intended audience before uploading. A separate project file is not automatically visible in the organization’s document library or in another project’s chat.

## Upload and inspect

1. Open the target project and select **Knowledge**.
2. Choose the destination folder, then select **Add file** and upload the transcript.
3. Open the file and confirm the title and readable text.
4. Wait for **Indexed** before testing search. **Queued** and **Indexing…** mean the file is still being prepared.

<Frame caption="Use the project’s file list to confirm the destination and indexing status.">

![The project Knowledge tab shows uploaded files and their indexing badges.](/images/platform/project-knowledge-files.webp)

</Frame>

If the status is **Failed**, inspect the error and use **Retry indexing** after addressing it. If it is **Not indexed**, use **Index now** when offered. Persistent failures may need an admin to check storage, extraction and the embedding provider. [Manage project files](/platform/projects/manage-files) explains the states and limits.

## Verify retrieval from the project

Open a chat in the same project. Ask a narrow question whose answer you checked in the transcript, such as “In the September 14 review, who agreed to prepare the next draft?” Inspect the cited source and compare the answer with the original text. A completed upload alone does not prove retrieval works, and an assistant answer is not a substitute for that comparison.

Check provider routing before using sensitive transcripts: indexing may send text to an embedding provider, and answering may send retrieved passages to a chat model. Local transcription alone does not keep these later steps local. Ask the admin or operator to verify both routes.

## Make the delivery repeatable

For occasional meetings, keep the upload checklist. For repeated delivery, have a developer use the [project upload API](/develop/api-reference) or an [automation webhook](/tutorials/developer/trigger-automation-via-webhook) with an explicitly authored ingestion automation. A webhook starts that automation; it is not a transcript-storage endpoint by itself.

The integration must choose the project, avoid duplicate deliveries, request indexing and monitor its result. REST project-file uploads skip indexing by default unless the bind requests `skipRagIndexing: false`. Reusing a filename does not create a revision; use the supported replacement flow when you need reviewed version history.
