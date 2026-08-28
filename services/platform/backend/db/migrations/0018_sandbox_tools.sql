-- 0.5 app migration 0018: the workspace-tool dispatch ledger — one row per
-- in-sandbox tool call (who/what/when/outcome + a sorted param-KEY
-- fingerprint, never values; RAG calls also record the knowledge refs they
-- served — the run's read-set for provenance).

CREATE TABLE app.sandbox_tool_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  session_id text NOT NULL,
  tool text NOT NULL,
  user_id text,
  outcome text NOT NULL,
  params_fingerprint text,
  knowledge_refs text[],
  minted_key_id text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX sandbox_tool_calls_session
  ON app.sandbox_tool_calls (session_id, created_at_ms DESC);
CREATE INDEX sandbox_tool_calls_org
  ON app.sandbox_tool_calls (org_id, created_at_ms DESC);
