-- 0.5 app migration 0063: GIN index over documents.history_files.
--
-- The ref-release seam (domains/knowledge/release.ts) decides whether a
-- blob's BYTES may be deleted by asking "does any document still hold this
-- ref — as its current file_ref OR inside its retained history?". The
-- history probe is `history_files @> ARRAY[ref]`; without an index every
-- purge, release job, and reconcile-sweep ref pays a sequential scan over
-- app.documents. `documents_org_file_ref` (0011) already covers the current-
-- ref probe; this GIN covers the history containment probe (the planner
-- BitmapAnds it with the org btree).
CREATE INDEX IF NOT EXISTS documents_history_files_gin
  ON app.documents USING gin (history_files);
