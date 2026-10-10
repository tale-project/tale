-- Switch off the seeded GitHub schedules that never started a run.
--
-- Every organization is seeded with the packs `github-triage-issues` and
-- `github-review-pull-requests`, each bound to a schedule that was switched
-- on. Their inputs require `owner` and `repo`, which a schedule never
-- carries, so once a version was deployed every occurrence was refused
-- (`start_refused`), and before that every occurrence was skipped
-- (`not_deployed`): a schedule that could never start a run, ticking in
-- every organization. Packs now seed their triggers switched off, and the
-- trigger's fixed input is where a person names the repository before
-- turning it on.
--
-- Only rows that provably never worked move: bound by the provisioning
-- (`created_by`), still switched on, and never fired. One an organization
-- got running keeps its state. This is the one change to existing trigger
-- rows; nothing else about them is touched, and switching one back on is a
-- save on the General tab.
--
-- Rolling-deploy safe: the previous image reads `enabled` as it always has,
-- and the next-due reset trigger (0170) drops the row's next-due instant, so
-- neither scan claims it. The previous image's provisioning binds a trigger
-- only where none exists, so it never switches one of these back on.

UPDATE app.automation_triggers
SET enabled = false,
    updated_at_ms = (extract(epoch FROM clock_timestamp()) * 1000)::bigint
WHERE kind = 'schedule'
  AND enabled
  AND name IN ('github-triage-issues', 'github-review-pull-requests')
  AND created_by = 'system:provisioning'
  AND last_fired_at_ms IS NULL
  AND last_run_id IS NULL;
