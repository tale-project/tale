-- Room on the page for the rows a chat turn rewrites.
--
-- A turn rewrites its `app.generations` row on every progress write (every
-- 250 ms to 1 s while it streams, `domains/chat/store.ts`) and at each tool
-- step, and its thread's `app.thread_metadata` row at the REST door's accept,
-- at the open and at the end. None of those writes changes an indexed column
-- (generations: `thread_id`, `org_id`; thread_metadata: `thread_id`, `org_id`,
-- `user_id`, `project_id`, `share_token`, `branch_root_id`), so each can be a
-- HOT update: the new version of the row stays on its page and no index gets
-- an entry. That needs free room on the page, and at the default fillfactor
-- (100) inserts fill a page completely, so an update of a row on a full page
-- puts the new version on another page and adds an entry to every index of
-- the table.
--
-- A fillfactor keeps that room free of inserts: 30% of a generations page,
-- whose row is rewritten all through its turn and grows with the streamed
-- text, and 15% of a thread_metadata page, whose row is rewritten a few times
-- a turn and lives as long as its conversation.
--
-- Rolling-deploy safe: a storage parameter only Postgres reads, set under
-- SHARE UPDATE EXCLUSIVE, so reads and writes go on while it applies. It
-- governs the pages filled from now on and rewrites none (that would take
-- ACCESS EXCLUSIVE): a generations row lives for one turn, so that table
-- follows at once, and thread_metadata follows as its rows are rewritten.

ALTER TABLE app.generations SET (fillfactor = 70);

ALTER TABLE app.thread_metadata SET (fillfactor = 85);
