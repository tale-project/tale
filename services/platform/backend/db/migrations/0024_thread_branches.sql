-- 0.5 app migration 0024: edit/regenerate branch lineage — the remaining
-- 0.4 branch columns (`0023` carried branch_root_id / hidden / the fork
-- message stamp). A branch records its PARENT sibling and the fork
-- sequence; the ROOT row carries the bounded selection map (which sibling
-- each fork point currently shows, JSON-encoded like 0.4).

ALTER TABLE app.thread_metadata ADD COLUMN branch_parent_id text;
ALTER TABLE app.thread_metadata ADD COLUMN branch_fork_sequence int;
ALTER TABLE app.thread_metadata ADD COLUMN branch_selections text;
