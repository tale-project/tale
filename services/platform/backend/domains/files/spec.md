# Files — who can read an uploaded file, and how long its content is kept

> **Prefix** `FILE-`

Every file a person or an agent uploads is stored once and then attached to something: a
document, a chat thread, a task, an email. These rules cover who can read a file, who can
attach an upload, what is done with a file once it is registered, and when its content is
removed. Downloading in parts, the transfer of files to and from sandboxes, and transcription
are not covered; see Not yet.

## Who can read a file

A file has no access rules of its own. It is read through what it is attached to:

| The file is attached to | It can be read by |
| --- | --- |
| a document | whoever can read the document |
| a chat thread | whoever can read the thread |
| an email in a conversation | whoever can read the conversation |
| a task, as a deliverable | whoever can read the task |
| nothing yet | the person who uploaded it |

### FILE-R1 · A file is read through what it is attached to

A file attached to a document follows the document's access alone. A file attached to several
things can be read through any one of them.

- **Example**: A report is attached to a task in a project Mia can read → she can open the
  report. Noah cannot read that project → he cannot.

### FILE-R2 · An upload attached to nothing yet is readable only by its uploader

Knowing the address of someone else's upload gives nothing.

- **Example**: Noah uploads a file and has not sent his message yet. Mia requests the file by
  its address → refused.

### FILE-R3 · A file of another organization is never readable

This holds for the person who uploaded it too, once they act in another organization.

- **Example**: Zoe uploaded a file in her own organization. Acting in Ada's organization, she
  requests it → refused.

### FILE-R4 · When an access check cannot be completed, the file is refused

A failure while checking access is passed on as a failure; it never opens the file.

- **Example**: The database cannot be reached while Mia opens a file → she gets an error, not
  the file.

## Uploading and attaching

### FILE-R5 · A person can attach only a file they uploaded themselves

An upload is tied to the person it was handed out to. Attaching a file that was handed out to
someone else, or that the caller did not upload, is refused.

- **Example**: Mia sends a chat message that names the stored address of a file Noah uploaded
  → refused.

### FILE-R6 · An upload that is never attached to anything is removed

An upload nobody used is cleaned up later, with its record. A file that is attached to
something, or vouched for, is left alone. When removing the content fails, the record is kept
so the next cleanup tries again.

- **Example**: Mia picks a file in the chat box and closes the tab without sending → the
  uploaded file is removed by a later cleanup.

### FILE-R7 · A refused upload says why; a failure does not leak its details

A refusal carries its code and a sentence for the person uploading (`FILE_SIZE_INVALID`). A
fault on the server's side is answered without its internal message.

- **Example**: The file store is unreachable while Mia uploads → she is told the upload
  failed (`OBJECT_STORE_UNAVAILABLE`), and no internal error text reaches her browser.

## What is done with a registered file

### FILE-R8 · What a file is decides whether it is indexed, transcribed or left alone

| The file is | What happens |
| --- | --- |
| a document that can be read as text | it is queued for the search index, in the same step that records it |
| an image | it is not indexed; its dimensions are recorded |
| an audio recording | it goes to transcription, never to the search index |
| of a type nothing can read | it is marked as unsupported, with the reason, and never queued |
| marked "do not index" by the uploader | it is left alone, and the choice is recorded |

- **Example**: Mia uploads a spreadsheet of a kind the indexer cannot read → the file is kept
  and shown as unsupported, with the indexer's reason.

## Keeping a file's content

### FILE-R9 · A file's content is kept while anything still uses it

Content is in use while a file record, a document (its current version or one that is kept), a
task, an email still waiting to be sent, or a person's chat message refers to it. Only content
nothing refers to is removed, and when it cannot be established whether something still does,
the content is kept.

- **Example**: The same PDF is attached to a task and to a document. The document is deleted →
  the PDF's content stays, because the task still uses it.

## Not yet

- **Downloading**: partial downloads, and which address a download or upload link points at
  on a deployment served under several addresses (`service.ts`, `routes.ts`).
- **Limits on a file's size and on a request body** (`bounded-body.ts`).
- **Files moving to and from a sandbox** (`sandbox-blob-routes.ts`).
- **Transcription** of audio and its cache (`transcription.ts`).
- **A file whose content is gone**: what a reader is told; several integration lanes hold the
  cleanup paths, which the guard does not read.
