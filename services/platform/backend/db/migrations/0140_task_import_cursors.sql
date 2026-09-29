-- Where a scheduled issue import resumes between its occurrences.
--
-- `github.list_import_issues` and `glitchtip.list_import_issues` read one
-- bounded batch per call and answer an opaque `nextCursor` while open issues
-- remain. A person continues a large import from the run page (Continue
-- import); a schedule has nobody to press it, so an automation that must
-- cover EVERY open issue keeps the cursor here between its occurrences: each
-- occurrence imports one batch from where the last one stopped until the
-- listing is drained, and the occurrence after that starts a fresh pass. The
-- schedule is the only clock — nothing here fires by itself.
--
-- One row per organization, project, external system and `source`, the
-- caller's name for the listing it pages through (`tale-project/tale`), so
-- automations naming the same source share one pass.
--
--   next_cursor         where the next batch starts; NULL when no pass is
--                       under way, and the next read starts from the first
--                       batch.
--   batch               batches the current pass has saved.
--   attempts            reads of the stored cursor since it was last saved.
--                       A batch that fails is read again next occurrence;
--                       after three reads without a save the next read
--                       starts the pass over instead of retrying a position
--                       the source keeps refusing (a renamed or transferred
--                       repository, an expired upstream cursor).
--   pass_started_at_ms  when the current pass saved its first batch.
--   last_drained_at_ms  when a pass last reached the end of the listing.
--
-- Written only by `task.save_import_cursor`, compare-and-set on the cursor
-- its run read, and by the read's attempt count: an import that failed saves
-- nothing, so its source retries the same batch next occurrence, and an
-- overlapping run cannot move a pass backwards. The refresh of issues already
-- imported keeps no row here — `task.list_external_issues` rotates its window
-- through the tasks' own attempt clocks (0117).
--
-- A new table: the previous image never reads or writes it.

CREATE TABLE IF NOT EXISTS app.task_import_cursors (
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  external_system text NOT NULL
    CHECK (external_system IN ('github', 'glitchtip')),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200),
  next_cursor text
    CHECK (next_cursor IS NULL OR char_length(next_cursor) BETWEEN 1 AND 12000),
  batch integer NOT NULL DEFAULT 0 CHECK (batch >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  pass_started_at_ms bigint,
  last_drained_at_ms bigint,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, project_id, external_system, source)
);
