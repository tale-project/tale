-- The chat a task was handed over from.
--
-- A chat answers; a task produces the file. "Create task from chat" hands a
-- conversation to a project agent, and until now the only thread between the
-- two was a link in the task's description: the chat never learned what became
-- of the work it handed over, so the person went looking for it on a board.
-- The conversation now keeps a live row for each task made from it — its
-- status, the agent's run, the files it delivered.
--
--   source_thread_id  the conversation's root thread (`app.threads.id`) the
--                     task was created from; NULL for every other task. Set
--                     once, at creation, and only for a thread the creator
--                     can read — their own, or one its owner shared with a
--                     project they can open. Not a foreign key: a trashed or
--                     purged conversation leaves the task as it is, and the
--                     chat side reads the link only while it can read both.
--
-- The index serves the chat's read ("the tasks made from this conversation"),
-- and only covers tasks that have a source.
--
-- Rolling-deploy safe: a nullable column and an index. The previous image
-- neither reads nor writes the column.

ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS source_thread_id text;

CREATE INDEX IF NOT EXISTS tasks_source_thread
  ON app.tasks (org_id, source_thread_id)
  WHERE source_thread_id IS NOT NULL;
