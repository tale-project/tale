-- WebDAV substrate (the 0.4 `webdavAppPasswords` + `webdavLocks` tables).
-- App passwords are PAT-equivalent HTTP Basic credentials: HMAC-SHA256 of
-- the secret under WEBDAV_APP_PASSWORD_HMAC_KEY, looked up by (org, 4-char
-- prefix) and compared constant-time. Locks are RFC 4918 write locks keyed
-- by the canonical percent-encoded resource path.

CREATE TABLE app.webdav_app_passwords (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  label text NOT NULL,
  password_prefix text NOT NULL,
  password_hashed text NOT NULL,
  created_at_ms bigint NOT NULL,
  last_used_at_ms bigint,
  revoked_at_ms bigint
);

CREATE INDEX webdav_app_passwords_org_user
  ON app.webdav_app_passwords (org_id, user_id);
CREATE INDEX webdav_app_passwords_org_prefix
  ON app.webdav_app_passwords (org_id, password_prefix);

CREATE TABLE app.webdav_locks (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  resource_path text NOT NULL,
  lock_token text NOT NULL UNIQUE,
  owner_xml text NOT NULL,
  depth text NOT NULL CHECK (depth IN ('0', 'infinity')),
  scope text NOT NULL CHECK (scope IN ('exclusive', 'shared')),
  owner_user_id text NOT NULL,
  app_password_id text NOT NULL,
  expires_at_ms bigint NOT NULL
);

CREATE INDEX webdav_locks_org_resource
  ON app.webdav_locks (org_id, resource_path);
CREATE INDEX webdav_locks_app_password
  ON app.webdav_locks (app_password_id);
