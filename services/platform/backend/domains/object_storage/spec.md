# Object storage — where files are stored, and how they move to an organization's own bucket

> **Prefix** `OBJ-`

Uploaded files are kept in an object store. A deployment has a default store, and an
organization can connect a bucket of its own and have its existing files moved there. These
rules cover how the default store is set up at start and what a move guarantees. Who can
connect a bucket and the test of a connection are not covered; see Not yet.

## The deployment's default store

### OBJ-R1 · The default store follows the environment until an operator takes it over

At start the deployment writes the store it finds in its environment into its settings, and
keeps the two in step: new credentials and a different bucket in the environment are taken
over. Settings an operator has marked as their own are never changed. A deployment whose
environment names no store writes nothing.

- **Example**: The operator rotates the storage credentials in the environment and restarts →
  the deployment's settings carry the new credentials.

### OBJ-R2 · The default bucket is created only when it is really missing

A bucket the credentials cannot list, but can use, is accepted as it is. When the bucket is
missing and the credentials cannot create one, the failure says which permission is missing.

- **Example**: The environment names a bucket that does not exist yet, and the credentials can
  create buckets → the bucket is created at start.

## Moving an organization's files to its own bucket

### OBJ-R3 · A file leaves the old store only after its copy is checked

Every file the organization's records refer to is copied with its type, the copy is compared
with the original, and only then is the original removed. A copy that arrives incomplete is
deleted, the original is kept, and the file is counted as failed. A copy left over from an
earlier attempt is trusted only when it matches; otherwise the file is copied again.

- **Example**: A move is interrupted halfway through a file → the next run finds the short
  copy, copies the file again, and removes the original only once the copy matches.

### OBJ-R4 · A trial move copies nothing and deletes nothing

It reports what a real move would do.

- **Example**: Ada starts a trial move → the report counts the files that would move, and both
  stores are unchanged.

### OBJ-R5 · Files are not moved when the organization's bucket is the default store itself

This holds however the connection is written: the same store under a different spelling of
its address, or reached under another name, is recognised. The move ends as failed with
nothing to move, on a trial move too, and no file is touched.

- **Example**: Ada connects her organization to the very bucket the deployment already uses
  and starts a move → the move stops, and every file stays where it is.

### OBJ-R6 · A move that stops making progress is marked as failed

It does not stay "running" forever, and a move that was marked as failed or finished does not
carry on.

- **Example**: The server restarts in the middle of a move → the move is marked as failed, and
  Ada can start it again.

## Not yet

- **Who can connect, test or remove an organization's bucket, and start a move**: owners and
  admins. No test holds it yet (`routes.ts`).
- **Testing a connection** before it is saved (`service.ts`).
- **Which records count as referring to a file** during a move: decided with the files
  domain.
