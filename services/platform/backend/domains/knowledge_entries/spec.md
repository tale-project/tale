# Knowledge entries — what an entry is, and what editing and deleting one do

> **Prefix** `KENTRY-` · **Docs** [`knowledge/knowledge-entries`](../../../../../docs/en/platform/knowledge/knowledge-entries.md)

A knowledge entry is a short fact with a topic and a body, such as the support hours. It is
part of the organization's knowledge and is found by the assistant's search. These rules cover
what an entry can hold, how editing keeps earlier versions, what deleting removes, and how an
agent writes entries. Which people can write entries and how an entry is indexed are not
covered; see Not yet.

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

## Agents writing entries

An agent of a project, or an automation's agent step, writes entries only when its equipment
includes the knowledge-entry write tool. It saves a fact under a topic, and the topic decides
which entry the fact belongs to.

### KENTRY-R10 · An agent with the write tool adds facts and new versions of them

A topic without an entry gets a new one; a topic with one gets a new version, which keeps the
topic's spelling. What an agent writes reads Source Agent, names the agent as its author and
is recorded in the audit log. A save that repeats the current text writes nothing.

- **Example**: Noah gives the project's agent the knowledge-entry write tool. The agent saves
  `Support hours` as 8–18 → a new entry appears, and its Source reads Agent.

### KENTRY-R12 · An agent's edit of a fact that changed since it read it is refused

To change an entry's text, the agent names the version it read. A save that names none, or one
that has been replaced since, is refused and writes nothing; the refusal hands the agent the
current version and its text, so it can merge its change in. A save that names a version of
an entry deleted since is refused too, and creates nothing.

- **Example**: The agent reads the return window as 30 days. Mia corrects it to 45 days. The
  agent then saves its own change onto the version it read → refused, and it is shown Mia's
  45 days.

### KENTRY-R13 · Agents' writes have a rate limit of their own

What agents write counts against a limit per organization that people's edits do not share.
Once agents reach it, a further save is refused with a time to try again after, and nothing
is written, while people keep editing.

- **Example**: An agent caught in a loop saves forty entries within a minute → its next save
  is told to wait, and Noah still saves his correction at once.

## Not yet

- **Who can read and write entries**: members read; editors and above write, as the user docs
  say. No test here holds it (`routes.ts`).
- **Indexing an entry**, its status and retrying a failed one.
- **Entries the assistant captures in chat, and entries over the REST API.**
- **Two writes at the same moment**: an integration lane proves that one wins and the other
  is refused cleanly; the guard does not read it (`write-races.integration.ts`).
