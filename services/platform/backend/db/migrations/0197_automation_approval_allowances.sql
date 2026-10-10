-- Writes one automation may make without a person approving each run.
--
-- A live write — a Slack message, an email, an HTTP POST — waits for a
-- person unless the organization's `approval_policy` lets it through, and
-- that file speaks for every automation at once: auto-approving
-- `slack.send_message` so one morning digest can post unattended lets every
-- automation post. An allowance is narrower: one automation, one write
-- action, granted by an owner or admin. The approval gate reads it for an
-- automation's step; a rule in `approval_policy` that requires a person for
-- the action still requires one (an operator's "never without a person"
-- holds over any automation's allowance).
--
--   granted_by     the owner or admin who granted it (a user id; an erasure
--                  replaces it with the erased-subject pseudonym, so the
--                  allowance keeps working and names nobody)
--   granted_at_ms  when it was granted
--   note           optional words from the granter, shown beside it
--
-- Removed with the automation (`deleteAutomationCascade`); an organization's
-- teardown removes it with every other row of the organization.
--
-- Rolling deploy: the previous image never reads the table, so its gate
-- asks a person as before until the new image serves the step. No backfill.

CREATE TABLE IF NOT EXISTS app.automation_approval_allowances (
  org_id text NOT NULL,
  automation_name text NOT NULL,
  connector text NOT NULL,
  action text NOT NULL,
  granted_by text NOT NULL,
  granted_at_ms bigint NOT NULL,
  note text,
  PRIMARY KEY (org_id, automation_name, connector, action)
);
