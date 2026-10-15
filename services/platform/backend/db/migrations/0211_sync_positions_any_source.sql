-- Issue sync positions for any source adapter, and the wait a rate limit asks
-- for.
--
-- `app.task_import_cursors` (0140) is the sync position store: where the
-- issue sync of one project's source resumes between runs. It used to know
-- two trackers by name (`github`, `glitchtip`); the issue sync is one
-- capability over a registry of source adapters, so a new tracker is one
-- adapter, and its positions must not wait for a schema change. The column
-- now takes any adapter slug in the connector catalog's grammar (lower-case
-- kebab, at most 64), which every row written so far already satisfies.
--
--   retry_after_ms  when the source's tracker asked to be left alone until
--                   (a rate limit with its Retry-After or reset time); NULL
--                   when it never asked. The sync skips the source until
--                   then, without reading the tracker. A rate limit raises
--                   it (never lowers it); nothing else writes it, so a save
--                   that met no rate limit keeps a wait another run stored,
--                   and a wait that has passed is simply not honoured.
--
-- Rolling-deploy safe: the previous image writes only `github` and
-- `glitchtip`, which the new check accepts, and never reads or writes the new
-- nullable column; its saves leave a wait in place, as this image's do.

ALTER TABLE app.task_import_cursors
  DROP CONSTRAINT IF EXISTS task_import_cursors_external_system_check;

ALTER TABLE app.task_import_cursors
  ADD CONSTRAINT task_import_cursors_external_system_check
  CHECK (
    char_length(external_system) BETWEEN 1 AND 64
    AND external_system ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  );

ALTER TABLE app.task_import_cursors
  ADD COLUMN IF NOT EXISTS retry_after_ms bigint;
