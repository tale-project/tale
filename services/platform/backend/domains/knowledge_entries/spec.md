# Knowledge entries — what an entry is, and what editing and deleting one do

> **Prefix** `KENTRY-` · **Docs** [`knowledge/knowledge-entries`](../../../../../docs/en/platform/knowledge/knowledge-entries.md)

A knowledge entry is a short fact with a topic and a body, such as the support hours. It is
part of the organization's knowledge and is found by the assistant's search. These rules cover
what an entry can hold, how editing keeps earlier versions, and what deleting removes. Who can
write entries and how an entry is indexed are not covered; see Not yet.

## What an entry holds

| Part | Limit |
| --- | --- |
| Topic | 1 to 120 characters |
| Content | 1 to 8,000 characters |

### KENTRY-R1 · A topic holds up to 120 characters and the content up to 8,000

Spaces around both are dropped first. An empty topic or content, and one over its limit, is
refused, and nothing is saved.

- **Example**: Noah saves an entry whose content is 8,001 characters long → refused.

### KENTRY-R2 · An organization has one current entry per topic

Two topics are the same when they differ only in upper and lower case or in spacing.

- **Example**: An entry `Support hours` exists. Noah saves a fact under `support  hours` → it
  reaches that same entry, and no second entry is created.

## Editing an entry

### KENTRY-R3 · Editing an entry adds a new version and keeps the one it replaces

The new version becomes the current one and is queued for the search index. A change of the
topic's spelling alone counts as an edit.

- **Example**: Noah corrects the support hours from 9–17 to 8–18 → the entry shows 8–18, and
  its version history shows the earlier 9–17.

### KENTRY-R4 · A save that repeats the current entry writes nothing

No version is added and nothing is indexed again. Spaces around the text make no difference.

- **Example**: Noah opens an entry and saves it without a change → the entry has the same
  version history as before.

### KENTRY-R5 · Only the current version of an entry can be edited

A save onto a version that has been replaced is refused (`KNOWLEDGE_ENTRY_SUPERSEDED`), and
the refusal names the current version, so the editor can be pointed at it. This holds even
when the text sent is identical.

- **Example**: Mia and Noah open the same entry. Noah saves a correction. Mia saves hers from
  the form she opened earlier → refused, with a pointer to Noah's version.

### KENTRY-R6 · A save that cannot store its content gives up with an error

When the file store does not answer in time, the save fails with its own code
(`KNOWLEDGE_ENTRY_STORE_TIMEOUT`) instead of waiting without end.

- **Example**: The file store hangs while Noah saves an entry → after a short wait he is told
  the save failed, and he can try again.

## Deleting an entry

### KENTRY-R7 · Deleting the current entry removes the entry with all its versions

Its content is taken out of knowledge search. Deleting one earlier version removes that
version alone: the current fact stays. An entry that is already deleted is answered as not
found (`KNOWLEDGE_ENTRY_NOT_FOUND`).

- **Example**: Noah deletes the entry `Return window` → the entry and its history are gone,
  and the assistant no longer finds the fact.

### KENTRY-R8 · A delete stands even when the search index cannot be updated at once

The entry is gone for readers immediately, and removing it from the index is tried again.

- **Example**: The search index is unreachable while Noah deletes an entry → the entry is
  deleted, and its content is removed from the index once the index answers again.

### KENTRY-R9 · An entry whose document is gone can no longer be edited

Each entry is backed by a document. When that document is no longer active, a save is
answered as not found (`KNOWLEDGE_ENTRY_NOT_FOUND`), and the entry's versions are retired with
the document.

- **Example**: The document behind an entry was deleted while Noah had the entry's form open.
  He saves → refused as not found.

## Not yet

- **Who can read and write entries**: members read; editors and above write, as the user docs
  say. No test here holds it (`routes.ts`).
- **Indexing an entry**, its status and retrying a failed one.
- **Entries the assistant captures in chat, and entries over the REST API.**
- **Two writes at the same moment**: an integration lane proves that one wins and the other
  is refused cleanly; the guard does not read it (`write-races.integration.ts`).
