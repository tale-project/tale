-- Automations remember WHEN a version's tests were last judged, beside the
-- verdict.
--
-- `tests_passed` (0019) is the per-version verdict the builder records at
-- save and the deploy gate stamps at deploy. It read NULL for a version the
-- gate had just refused for failing tests (2026-09-13 evaluation, E4-04):
-- the gate answered its report and persisted nothing, so
-- `GET /api/v1/automations/{name}/versions` could not tell "no tests" from
-- "the tests fail" — the one distinction a release pipeline branches on.
-- The gate now writes the verdict it reached, `false` included, an MCP save
-- of a document with tests records the save's own run, and the latest
-- verdict wins. This column says when that verdict was reached, so a
-- client can tell a fresh gate result from one recorded at save time, and
-- NULL from "never judged"; the API answers it as `testsCheckedAt`.
--
-- Nullable: a version saved without a verdict reads NULL for both columns,
-- and the API answers `testsCheckedAt: null` for exactly that. No backfill —
-- an existing verdict has no known time. Rolling-deploy safe: the previous
-- image neither reads nor writes the column, and every write that names it
-- comes from the new image.

ALTER TABLE app.automations
  ADD COLUMN IF NOT EXISTS tests_checked_at_ms bigint;
