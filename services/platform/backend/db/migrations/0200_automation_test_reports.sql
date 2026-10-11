-- What a version's tests found the last time they ran, test by test.
--
-- `tests_passed` (0019) and `tests_checked_at_ms` (0100) say whether a
-- version's tests passed and when that was judged, but not which test failed
-- or why, so the editor could only draw a tick or a cross. The report beside
-- them names each test, whether it passed, and for one that failed what kind
-- of failure it was with the few values a difference shows — never a trace,
-- an output or anything the document does not already hold. Its shape is
-- `storedTestReportSchema` (`lib/shared/schemas/automation-tests.ts`), capped
-- at 64 KB by the writer.
--
-- `tests_checked_via` says which act judged it — a save, the deploy gate, or
-- someone running the tests by hand — and `tests_checked_by` who, in the
-- vocabulary of `created_by` (a user id, `api-key:<userId>`).
--
-- Rolling-deploy safe: nullable, no backfill. The previous image keeps
-- writing the verdict without a report; the report carries the time it was
-- made, and a reader shows it only when that matches `tests_checked_at_ms`.
ALTER TABLE app.automations
  ADD COLUMN IF NOT EXISTS tests_report jsonb,
  ADD COLUMN IF NOT EXISTS tests_checked_via text
    CHECK (tests_checked_via IN ('save', 'deploy', 'manual')),
  ADD COLUMN IF NOT EXISTS tests_checked_by text;
