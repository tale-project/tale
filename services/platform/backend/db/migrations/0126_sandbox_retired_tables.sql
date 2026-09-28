-- Drop the two 0.4 sandbox tables no 0.5 caller ever wired.
--
-- 0017 ported them from the Convex stack along with the rest of the session
-- substrate:
--
--   * `app.sandbox_admission_tickets` — the FIFO park-on-capacity lane. 0.5
--     parks a run that meets a full organization on its own ledger row
--     instead (`project_agent_runs.waiting_for_capacity_at_ms`, woken on the
--     release edges in domains/sandbox/sessions.ts); no 0.5 caller ever
--     handed the reserve a ticket, so no row was ever admitted through it.
--   * `app.sandbox_agent_checkpoints` — the workflow re-attach cursor. A
--     workflow agent turn re-attaches from its run's own cursor
--     (`automation_runs.checkpoints`) and its op row on
--     `app.sandbox_session_ops` (domains/automations/reattach.ts); nothing
--     ever advanced this one.
--
-- Up to v0.5.8 the session destroy path still cleared both tables for the
-- session it destroyed; v0.5.9 (2026-09-06) removed that and every other
-- statement naming them, and since then no shipped image has read or written
-- either. Dropping them is the retire-a-table doctrine's second step with the
-- first long met, so the previous image keeps working against the new shape.
-- A deployment still at v0.5.8 or older should first step to a release from
-- v0.5.9 on that predates this file; otherwise its old image's session
-- destroys fail for the length of the roll.
--
-- Nothing references either table, so no foreign key or view goes with them;
-- their indexes drop with the tables. Organization teardown reads the
-- org-keyed tables from the catalog, so it simply stops listing them.
-- Idempotent: a re-run after a half-failed deploy finds nothing to drop.

DROP TABLE IF EXISTS app.sandbox_admission_tickets;

DROP TABLE IF EXISTS app.sandbox_agent_checkpoints;
