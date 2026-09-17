---
title: Ask about files and images
description: Attach a document, image, or recording to a chat and understand when its contents are ready for the assistant.
---

Attach a file when it is needed for the current conversation. The assistant receives images, retrieves text from supported documents, and reads transcripts of recordings. For files that several chats should reuse, upload them to a [project](/platform/projects/manage-files) or the [Knowledge library](/platform/knowledge/documents) instead.

## Add an attachment

Open the `+` menu beside the message field and choose **Add photos & files**. You can also drag files onto the composer or paste a screenshot into the message field. A message can carry up to ten files.

Images appear as thumbnails; other files appear as named chips with their processing status. Check the filenames before sending. Use a staged attachment’s remove control to leave it out of the message.

<Frame caption="A staged document shows its name and processing state before it is sent with your question.">

![The chat composer shows an attached document above the message field, with its processing status and a control to remove it.](/images/platform/chat-document-attachment.webp)

</Frame>

Write a question that tells the assistant what to look for, such as “Read the meeting note and list the decisions, their owners, and any missing deadlines.” Attaching a file without a question leaves the intended task unclear.

When you try to attach audio or video, Tale checks whether the organization has an available transcription model. If the check prevents the upload, a dialog explains the problem and offers the recovery actions you can use. Those files are refused before transfer; other supported files in the same selection can still upload. Close the dialog to keep composing, follow the settings action if you have access, or ask an admin to check [Models](/platform/admin/governance/content-models).

## Understand what the assistant receives

| Attachment | What the model uses | What to check |
| --- | --- | --- |
| Image or pasted screenshot | The image itself, when the selected model supports vision. | Confirm the picker offers an image-capable model and the text is legible. |
| PDF, modern Office document, or supported text file | Text made available through the assistant’s retrieval tools. | Wait for processing and check for a reading step in the reply. |
| Audio or video file | A text transcript. | An admin must configure transcription; check names, numbers, and specialist terms against the recording. |
| Legacy Office file without a text extractor | The filename, without searchable document text. | Save it as `.docx`, `.xlsx`, or `.pptx` and attach that copy. |

File upload support and text extraction are separate. A file that appears in the chat is not necessarily a file whose contents the assistant can read.

## Send while processing continues

If documents or recordings are still processing when you send, Tale queues the message and sends it after they are ready. The queued message appears above the composer. Cancel it there if you need to change the question; its text returns to the field.

Paste a supported video link into the message field to start creating an attachment. A URL entered by typing stays ordinary message text. Tale retrieves captions first and uses audio transcription when captions are unavailable, then supplies the transcript to the assistant. Pasting a link remains available without a transcription model because usable captions do not need one. If that link fails, retry it or remove it before sending.

A model change applies to new transcription work; completed attachments keep their existing transcript. Uploading the same bytes again reuses completed work for the same transcription target, but transcribes them again when the target provider or model differs.

## Keep the file in the right place

Chat attachments belong to that conversation. They do not automatically enter the organization’s Knowledge library or become available in another chat. Switching conversations clears staged attachments, so check the chips again after changing chats.

A regenerated reply uses the original message’s stored attachments. If you need to ask about a different version of a file, send the new file and identify which version the assistant should use.

<Tip>

For recurring questions about a brief or policy, put the file in the appropriate project once. Start later chats inside that project instead of uploading a separate copy each time.

</Tip>

## Resolve attachment problems

| Symptom | Action |
| --- | --- |
| The image cannot be read by the selected model | Choose a vision-capable model. On Auto, Tale considers compatible image models; if none are available, ask an admin to configure one. |
| Processing fails | Retry the file. If a small supported file also fails, ask an admin to check storage, indexing, or transcription as indicated by the error. |
| The assistant knows the name but not the contents | Check the format and processing status. Convert legacy files to a supported modern format. |
| The answer invents detail from a recording | Check the transcript against the recording and supply the corrected passage before continuing. |
| A queued message has not sent | Inspect every attachment’s status, including video links. Remove or retry failed items. |

Return to [Chat basics](/platform/chat/basics) to check sources and continue the conversation.
