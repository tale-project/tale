-- 0.5 app migration 0008: projects + project agents.
--
-- Denormalized rollups (open/done task counts, agent count, task counter)
-- live as real columns with defaults — the 0.4 "optional means 0" reading
-- disappears. Uniqueness that 0.4 enforced with app-level probes (key,
-- externalItemId per org) is enforced by partial unique indexes here
-- (constitution rule 5: don't port Convex's missing-unique-index
-- workarounds faithfully). Deprecated 0.4 fields (taskLabelColors,
-- agentCapabilities, autonomyTier) are not carried — 0.5 is a fresh
-- instance.

CREATE TABLE app.projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,

  name text NOT NULL,
  description text,
  icon text,
  color text,
  -- Immutable short key prefixing task identifiers (KEY-1, KEY-2, …).
  key text,
  -- Opaque caller-owned external id; unique per org regardless of lifecycle.
  external_item_id text,
  -- Monotonic per-project counter backing task numbering (never recycled).
  task_counter int NOT NULL DEFAULT 0,

  -- Task rollups for the list row (open excludes archived/cancelled/done;
  -- cancelled counts NOWHERE so progress reads done/(open+done)).
  open_task_count int NOT NULL DEFAULT 0,
  done_task_count int NOT NULL DEFAULT 0,
  project_agent_count int NOT NULL DEFAULT 0,

  -- Sharing (matches agentBindings): both empty → org-wide.
  team_id text,
  shared_with_team_ids text[] NOT NULL DEFAULT '{}',

  instructions text,
  knowledge_mode text CHECK (knowledge_mode IN ('off', 'tool', 'context', 'both')),

  agent_mode text CHECK (agent_mode IN ('all', 'recommended', 'restricted')),
  recommended_agent_slugs text[] NOT NULL DEFAULT '{}',
  allowed_agent_slugs text[] NOT NULL DEFAULT '{}',

  model_mode text CHECK (model_mode IN ('all', 'recommended', 'restricted')),
  recommended_models text[] NOT NULL DEFAULT '{}',
  allowed_models text[] NOT NULL DEFAULT '{}',

  connectors_mode text CHECK (connectors_mode IN ('all', 'restricted')),
  allowed_connector_slugs text[] NOT NULL DEFAULT '{}',

  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  archived_at_ms bigint,
  pinned_at_ms bigint
);

CREATE INDEX projects_org ON app.projects (org_id, archived_at_ms);
CREATE INDEX projects_org_updated ON app.projects (org_id, updated_at_ms DESC);
CREATE UNIQUE INDEX projects_org_key
  ON app.projects (org_id, key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX projects_org_external_item
  ON app.projects (org_id, external_item_id) WHERE external_item_id IS NOT NULL;

-- User-created agent instances of a project (the instance IS the permission
-- for task assignment). Secret VALUES never live here — names only.
CREATE TABLE app.project_agents (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  name text NOT NULL,
  harness text NOT NULL,
  model text NOT NULL,
  model_provider text,
  skills text[] NOT NULL DEFAULT '{}',
  connectors text[] NOT NULL DEFAULT '{}',
  tools text[] NOT NULL DEFAULT '{}',
  secrets text[] NOT NULL DEFAULT '{}',
  instructions text,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX project_agents_project ON app.project_agents (project_id);
CREATE INDEX project_agents_org ON app.project_agents (org_id);
