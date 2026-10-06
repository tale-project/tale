# Retention — what the automatic cleanup deletes, what it spares, and what it records

> **Prefix** `RETAIN-` · **Docs** [`admin/governance/policies-and-limits`](../../../../../docs/en/platform/admin/governance/policies-and-limits.md)

An organization can set how long each kind of data is kept. A cleanup runs on a schedule and
deletes what is older than that. These rules cover what the cleanup spares, what it records
about what it destroyed, and what happens when it fails part-way. The periods themselves and
the trash are not covered; see Not yet.

## What the cleanup spares

### RETAIN-R1 · The cleanup never deletes the data of a person under a legal hold

Data created or owned by a held person is left out of every pass, however old it is. In the
audit log, the cleanup stops at the first entry that is by the held person or about them, and
keeps everything from there on.

- **Example**: Noah is under a legal hold. The retention period for documents is one year, and
  Noah has a document from three years ago → it is not deleted.

### RETAIN-R2 · An organization under a hold loses nothing to the cleanup

The run is recorded as started and completed, and destroys nothing.

- **Example**: The whole organization is under a legal hold → last night's cleanup is on
  record, with nothing deleted.

### RETAIN-R3 · A category that is switched off, or has no period, is left alone

- **Example**: The organization has set no period for its audit log → the cleanup deletes no
  audit entries.

### RETAIN-R4 · An organization without a valid retention policy is not cleaned up at all

Nothing is deleted and nothing is recorded for it.

- **Example**: An organization's retention settings are damaged → the cleanup skips it.

### RETAIN-R5 · A minimum for the audit log below 180 days is not accepted

A deployment can give an organization bounds for its retention periods. Bounds that put the
audit log's minimum below 180 days are not applied: the reason is written to the server log,
and the organization is treated as having no bounds at all.

- **Example**: A deployment sets a 179-day minimum for an organization's audit log → the
  bounds are ignored, and the server log says the minimum must be at least 180 days.

## What the cleanup records

### RETAIN-R6 · Each run records the policy it enforced and what it destroyed, per category

A run opens with an entry that states the policy in force and the holds in effect. For each
category it destroyed something in, it writes one entry with the counts, in the same step as
the deletion, so the record and the deletion stand or fall together. A category that
destroyed nothing gets no entry.

- **Example**: A run deletes 40 old conversations and nothing else → the audit log has the
  run's opening entry and one entry for conversations, with 40.

### RETAIN-R7 · A cleanup that fails says so, and carries on with the next organization

When one record that was due could not be deleted, the run is recorded as failed, with that
record counted apart from what was destroyed. An error in one organization's run is charged to
the category it happened in, and the cleanup moves on to the next organization.

- **Example**: A file store error keeps one document from being deleted → the run is recorded
  as failed with one record not destroyed, and the other organizations are still cleaned up.

## What goes with a deleted record

### RETAIN-R8 · Deleting an old conversation also removes its email content from search

The bodies of the emails that were indexed for search are released with the conversation, and
its emailed attachments with it. A conversation kept because of an attachment loses nothing.

- **Example**: A two-year-old conversation is deleted by the cleanup → its emails no longer
  turn up in knowledge search.

### RETAIN-R9 · Hiding an expired document also retires the knowledge entries it backed

- **Example**: A document behind a knowledge entry passes its retention period → the document
  is hidden, and the entry goes with it.

## Not yet

- **The periods**: which categories exist, their defaults and limits, and who can set them
  (`routes.ts`).
- **The trash**: how long a deleted record can be restored, and emptying it.
- **How much one run deletes** before leaving the rest to the next run.
- **Automation runs and the audit chain**: the order in which the two are locked when runs are
  deleted. Its tests are about that order, not a rule a reader would look up.
