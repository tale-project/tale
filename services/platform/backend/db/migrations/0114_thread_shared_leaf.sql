-- Share links freeze the branch on screen: the root remembers which sibling
-- its snapshot reads.
--
-- A share is taken on the lineage ROOT (the id the URL carries; the token,
-- status and Shared indicator all live there), but every edit / regenerate
-- tail lives in a hidden sibling thread. Reading the root's own rows at
-- `shared_at_ms` published the ORIGINAL branch whatever the owner was
-- looking at, and "Include newer messages" re-stamped a root whose rows
-- never change once a branch is active. `shared_thread_id` names the sibling
-- (or the root itself) the snapshot reads, frozen at share time; NULL means
-- "the root", which is what every share taken before this column existed
-- read. A stored sibling that is no longer active falls back to the root at
-- read time — the column is a pointer, never a gate.
--
-- Rolling-deploy safe: nullable, the previous image never reads or writes it.

ALTER TABLE app.thread_metadata
  ADD COLUMN IF NOT EXISTS shared_thread_id text;
