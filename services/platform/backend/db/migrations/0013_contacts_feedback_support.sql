-- 0.5 app migration 0013: contacts + message feedback + support cases.

-- The per-org correspondent directory (customers+vendors unified in 0.4).
CREATE TABLE app.contacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text,
  email text,
  phone text,
  external_id text,
  source text NOT NULL,
  locale text,
  address jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb,
  notes text,
  lifecycle_status text,
  status_changed_at_ms bigint,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX contacts_org ON app.contacts (org_id);
CREATE INDEX contacts_org_email ON app.contacts (org_id, email);
CREATE INDEX contacts_org_external ON app.contacts (org_id, external_id);
CREATE INDEX contacts_org_source ON app.contacts (org_id, source);

-- Thumbs up/down on assistant messages; one row per (message, user).
CREATE TABLE app.message_feedback (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text NOT NULL,
  user_id text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('positive', 'negative')),
  comment text,
  metadata jsonb,
  agent_slug text,
  model text,
  provider text,
  lifecycle_status text,
  status_changed_at_ms bigint,
  created_at_ms bigint NOT NULL,
  UNIQUE (message_id, user_id)
);

CREATE INDEX message_feedback_org_created
  ON app.message_feedback (org_id, created_at_ms DESC);
CREATE INDEX message_feedback_org_rating
  ON app.message_feedback (org_id, rating);
CREATE INDEX message_feedback_thread ON app.message_feedback (thread_id);

-- Customer support portal: org-scoped cases (support staff = active member).
CREATE TABLE app.support_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  subject text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority text CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  escalation_level int,
  escalated_at_ms bigint,
  assignee_type text CHECK (assignee_type IN ('user', 'agent')),
  assignee_id text,
  contact_id text REFERENCES app.contacts (id) ON DELETE SET NULL,
  requester_email text,
  requester_name text,
  sla_due_at_ms bigint,
  first_responded_at_ms bigint,
  resolved_at_ms bigint,
  closed_at_ms bigint,
  comment_count int NOT NULL DEFAULT 0,
  status_changed_at_ms bigint,
  created_by text NOT NULL,
  created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'agent')),
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  archived_at_ms bigint
);

CREATE INDEX support_cases_org ON app.support_cases (org_id);
CREATE INDEX support_cases_org_status ON app.support_cases (org_id, status);
CREATE INDEX support_cases_org_updated
  ON app.support_cases (org_id, updated_at_ms DESC);
CREATE INDEX support_cases_assignee
  ON app.support_cases (org_id, assignee_type, assignee_id);

CREATE TABLE app.support_case_comments (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  case_id text NOT NULL REFERENCES app.support_cases (id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('user', 'agent')),
  author_id text NOT NULL,
  body text NOT NULL,
  internal boolean,
  created_at_ms bigint NOT NULL,
  edited_at_ms bigint
);

CREATE INDEX support_case_comments_case
  ON app.support_case_comments (case_id, created_at_ms);

CREATE TABLE app.support_case_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  case_id text NOT NULL REFERENCES app.support_cases (id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent')),
  actor_id text NOT NULL,
  action text NOT NULL,
  from_value text,
  to_value text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX support_case_activity_case
  ON app.support_case_activity (case_id, created_at_ms);
