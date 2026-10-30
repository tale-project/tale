-- The workers of its agent whose sandbox host refused a run that waits for
-- room: full, short of memory, disk or CPU, under pressure, or the worker
-- still starting or being destroyed. A run's park adds the worker its start
-- was refused in (`parkAgentRunInTx`, reason `host`), once, for as long as
-- the run lives. Its next claims first take a worker that needs no such host
-- (`chooseWorker`, TASK-R85): one it was not refused in that is free, one
-- placed on a connected device with room as the sandbox hub reports it, or a
-- new worker while a device has room. So a run whose previous worker is on
-- a full server starts on a device that has room instead of asking that
-- server again until it gives up. When none fits it chooses as before and
-- waits in its previous worker. No worker is destroyed or emptied: the
-- refused worker's workspace stays for the task's later runs.
--
-- Empty on rows written before this column, and on rows the previous image
-- writes while a deployment rolls: that image neither adds to the list nor
-- reads it, and a run with an empty list chooses as it always did.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS host_refused_session_ids text[] NOT NULL DEFAULT '{}';
