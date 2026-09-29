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
--   revision            the position's compare token: a fresh value of
--                       `app.task_import_cursor_revisions` on every
--                       transition — each saved batch, each drain, each
--                       restart after failed reads — so it never repeats,
--                       even when the cursor text does.
--
-- Written only by `task.save_import_cursor`, compare-and-set on the
-- REVISION its run read (never on the cursor text: after a drain or a
-- restart the text returns to empty, and a later pass can reach the same
-- cursor again, so a stale save would match text and skip the new pass's
-- batch), and by the read's attempt count and restart. An import that failed
-- saves nothing, so its source retries the same batch next occurrence; a
-- save from any earlier revision — an overlapping run, a delayed run of a
-- completed pass, a stale end-of-list — is refused and writes nothing. The
-- refresh of issues already imported keeps no row here —
-- `task.list_external_issues` rotates its window through the tasks' own
-- attempt clocks (0117).
--
-- A new table and sequence: the previous image never reads or writes them.

CREATE SEQUENCE IF NOT EXISTS app.task_import_cursor_revisions;

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
  revision bigint NOT NULL
    DEFAULT nextval('app.task_import_cursor_revisions'),
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, project_id, external_system, source)
);

ALTER SEQUENCE app.task_import_cursor_revisions
  OWNED BY app.task_import_cursors.revision;
