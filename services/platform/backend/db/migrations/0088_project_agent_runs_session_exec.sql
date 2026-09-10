-- The Sandboxes settings view resolves the task behind each displayed exec.
-- Standing workspaces can have long run histories; keep this org-scoped
-- lookup bounded to the selected session/exec pairs and their newest run.
CREATE INDEX IF NOT EXISTS project_agent_runs_session_exec
  ON app.project_agent_runs (org_id, session_id, exec_id, seq DESC)
  INCLUDE (task_id);
