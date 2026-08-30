-- 0.5 app migration 0011: the Document Hub core (documents + folders).
--
-- Scope model (one owner: documents/access): a document/folder is EITHER a
-- project row (project_id set, visible only inside the project) OR a
-- Knowledge Hub row (team rules; no teams = org-wide). Controlled-record
-- lifecycle ships as a nullable jsonb (the records flow lands with
-- approvals); sync-config lanes (onedrive/google drive) land with their
-- domains.

CREATE TABLE app.folders (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  parent_id text REFERENCES app.folders (id) ON DELETE CASCADE,
  team_id text,
  team_tags text[] NOT NULL DEFAULT '{}',
  project_id text REFERENCES app.projects (id) ON DELETE CASCADE,
  created_by text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX folders_org_parent_name ON app.folders (org_id, parent_id, name);
CREATE INDEX folders_org_project ON app.folders (org_id, project_id);

CREATE TABLE app.documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  title text,
  content text,
  -- Blob reference (`s3:<key>` in 0.5).
  file_ref text,
  mime_type text,
  extension text,
  -- Connector slug for connector-sourced docs; `upload` / `agent` reserved.
  source_provider text,
  external_item_id text,
  site_id text,
  drive_id text,
  content_hash text,
  history_files text[] NOT NULL DEFAULT '{}',
  team_id text,
  team_tags text[] NOT NULL DEFAULT '{}',
  -- Mutually exclusive with team scoping (documents/access owns the rule).
  project_id text REFERENCES app.projects (id) ON DELETE SET NULL,
  scanned_pages_detected int,
  ocr_applied boolean,
  source_created_at_ms bigint,
  source_modified_at_ms bigint,
  created_by text,
  folder_id text REFERENCES app.folders (id) ON DELETE SET NULL,
  folder_path text,
  metadata jsonb,
  lifecycle_status text,
  status_changed_at_ms bigint,
  -- Controlled-record lifecycle (records flow lands with approvals).
  record jsonb,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX documents_org ON app.documents (org_id);
CREATE INDEX documents_org_lifecycle ON app.documents (org_id, lifecycle_status);
CREATE INDEX documents_org_folder ON app.documents (org_id, folder_id);
CREATE INDEX documents_org_created_by ON app.documents (org_id, created_by);
CREATE INDEX documents_org_source ON app.documents (org_id, source_provider);
CREATE INDEX documents_org_external ON app.documents (org_id, external_item_id);
CREATE INDEX documents_org_title ON app.documents (org_id, title);
CREATE INDEX documents_org_title_folder ON app.documents (org_id, title, folder_id);
CREATE INDEX documents_org_file_ref ON app.documents (org_id, file_ref);
CREATE INDEX documents_org_project ON app.documents (org_id, project_id);
CREATE INDEX documents_org_updated ON app.documents (org_id, updated_at_ms DESC);
