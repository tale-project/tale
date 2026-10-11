-- What each version of an automation was based on, restored from, and changed.
--
-- A version already says who saved it (`created_by`) and through which door,
-- with which key and client (0181). It did not say which version the saved
-- content was built from, whether it brought an older version back, or what
-- it changed — so a history could not say "restored v3" or "2 nodes changed",
-- and a reader comparing versions had to diff every pair itself.
--
-- `based_on_version` is the version the saver's draft started from (the
-- editor's base, the version a restore copies); `restored_from_version` is
-- set only by a restore. `change_summary` is what the version changed
-- against the one saved before it, as counts and flags only, never content
-- (`changeSummaryOf`, `lib/engine/core/diff/changes.ts`): the number of
-- nodes added, removed, changed and renamed, and flags for the inputs, the
-- output, the description, the tests and the package data. Version 1 is
-- marked `first` and counts only the nodes it starts with; a version whose
-- document is the one before it is marked `identical`.
--
-- The history (`versions.ts`) reads them; nothing decides with them.
--
-- Rolling-deploy safe: three nullable columns, no default, no rewrite. A
-- version the previous image saves during the roll leaves them NULL, which
-- every reader treats as "not recorded" — as it does for every version saved
-- before this one.
ALTER TABLE app.automations
  ADD COLUMN IF NOT EXISTS based_on_version int
    CONSTRAINT automations_based_on_version_check
    CHECK (based_on_version IS NULL OR based_on_version >= 1),
  ADD COLUMN IF NOT EXISTS restored_from_version int
    CONSTRAINT automations_restored_from_version_check
    CHECK (restored_from_version IS NULL OR restored_from_version >= 1),
  ADD COLUMN IF NOT EXISTS change_summary jsonb;
