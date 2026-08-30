-- Pooled warmed browser sessions (the 0.4 `browserSessions`): per-org,
-- per-domain cookie jars an operator imported after clearing a site's bot
-- wall in a real browser. The video-link ingest claims the LRU healthy
-- session for its yt-dlp spawn; a burned session cools and eventually
-- expires. Jars are encrypted at rest (JWE) and never leave the server.

CREATE TABLE app.browser_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  domain text NOT NULL,
  cookies_encrypted text NOT NULL,
  user_agent text,
  visitor_data text,
  po_token text,
  label text,
  status text NOT NULL CHECK (status IN ('healthy', 'cooling', 'expired')),
  source text NOT NULL,
  expires_at_ms bigint NOT NULL,
  last_used_at_ms bigint,
  failure_count int NOT NULL DEFAULT 0,
  created_by text,
  created_at_ms bigint NOT NULL
);

-- Claim path: org-scoped LRU walk (tenant isolation is the index prefix).
CREATE INDEX browser_sessions_claim
  ON app.browser_sessions (org_id, domain, status, last_used_at_ms);
CREATE INDEX browser_sessions_status ON app.browser_sessions (status);
