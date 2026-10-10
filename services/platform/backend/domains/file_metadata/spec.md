# File metadata — what a file's indexing status means, and what a stuck one turns into

> **Prefix** `FMETA-`

Each stored file has a record that says whether its content was read into the search index,
and which email attachments a conversation carries. These rules cover what the indexing status
of a file means, what happens to indexing that got stuck, and whose email attachments are
listed. Transcription of audio is not covered; see Not yet.

## A file's indexing status

| Status | Meaning |
| --- | --- |
| pending | nobody has queued the file for indexing yet |
| queued, running | indexing is waiting or in progress |
| completed | the file's content is in the search index |
| failed | indexing failed; the status carries the reason |
| unsupported | no reader exists for this kind of file |
| skipped | the uploader chose not to index the file |

### FMETA-R1 · A file its uploader chose not to index reads as skipped, whatever else is stored

The choice wins over any status the file had before. A file that nobody queued and nobody
opted out reads as pending.

- **Example**: Mia uploads a contract and chooses not to have it indexed → its status is
  skipped, and it stays skipped.

### FMETA-R2 · Indexing that got stuck ends as failed, with advice to retry indexing

A file that stayed queued or running for too long is marked as failed. The message tells the
person to use **Retry indexing**, never to upload the file again. When the index itself
recorded why it failed, that reason is shown instead of the general message.

- **Example**: The server restarts while a file is being indexed → the file later shows as
  failed, with the advice to retry indexing.

### FMETA-R3 · A failed file keeps its own reason

The cleanup of stuck files never replaces the reason a failed file already carries with the
general message, and it never shows a reason without its code or a code without its reason.

- **Example**: A file failed because no embedding model is configured → it keeps saying so
  after the cleanup has run.

### FMETA-R4 · One file that cannot be updated does not stop the cleanup for the others

The file is left for the next run, the files after it are still handled, and the cleanup
carries on with the next organization. An organization whose files fail twice in a row is
left for the next run as a whole.

- **Example**: A file's record is locked by another operation during the cleanup → that file
  is skipped this time, and the other stuck files are still marked as failed.

## Email attachments

### FMETA-R5 · Attachments are listed only for a conversation that is live and not spam

Attachments of a conversation that is marked as spam, is in the trash or was deleted are
listed for nobody, an owner included. For a live conversation they are listed for the people
who can read it.

- **Example**: A conversation with an attached invoice is moved to the trash → the invoice no
  longer appears in the list of email attachments.

## Not yet

- **Transcription** of audio and dictation, and its cache (`core/file_metadata/`).
- **How long "too long" is** in `FMETA-R2`, and how often the cleanup runs (`watchdogs.ts`).
- **Who can retry indexing**: decided by the documents domain.
