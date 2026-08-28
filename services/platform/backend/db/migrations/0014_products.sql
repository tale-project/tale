-- 0.5 app migration 0014: the product catalog.
-- Per-org unique name (case-insensitive) via expression unique index — the
-- 0.4 app-level probe becomes a real constraint (constitution rule 5).

CREATE TABLE app.products (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  stock double precision,
  price double precision,
  currency text,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  status text CHECK (status IN ('active', 'inactive', 'draft', 'archived')),
  -- [{language, name?, description?, category?, tags?, metadata?, lastUpdated}]
  translations jsonb,
  external_id text,
  metadata jsonb,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE UNIQUE INDEX products_org_name
  ON app.products (org_id, lower(name));
CREATE INDEX products_org_status ON app.products (org_id, status);
CREATE INDEX products_org_category ON app.products (org_id, category);
CREATE INDEX products_org_external ON app.products (org_id, external_id);
CREATE INDEX products_org_updated
  ON app.products (org_id, updated_at_ms DESC);
