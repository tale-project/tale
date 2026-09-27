-- Organization-owned sandbox devices and their single-use join tokens.
--
-- A sandbox device is a machine an organization connected with
-- `tale sandbox connect`: it runs the organization's sandboxes on its own
-- hardware and dials the deployment's spawner (the device hub) over one
-- outbound WebSocket. The hub holds live connections and session placement;
-- this is the registry behind them — which devices an organization has, the
-- credential each presents, and what it last reported about itself.
--
-- Two credentials, both "answered once, hash stored" (the SCIM token's and
-- the trusted-header key's posture):
--   * a JOIN TOKEN, minted in Settings → Sandboxes and embedded in the
--     one-line install command. It lives an hour and works once: the device
--     trades it for its own secret, so the command left in a shell history is
--     spent by the time anyone reads it;
--   * the DEVICE SECRET, which the device keeps (owner-only) and presents to
--     mint short-lived connect tickets. The organization is resolved FROM the
--     secret — never from a header, a body or a path.
--
-- Removing a device is a stamp, never a delete: the row stays the audit
-- trail behind the work the device ran, and a stamped row never matches a
-- presented secret. Every row is organization-scoped (org_id), so organization
-- deletion sweeps both tables with everything else it owns.
--
-- Rolling-deploy safe: two new tables, nothing existing changes.

CREATE TABLE app.sandbox_devices (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- The name the machine announced (its hostname unless `--name` was given).
  name text NOT NULL,
  -- SHA-256 (hex) of the device secret; the plaintext is answered once, at
  -- join, and never stored.
  secret_hash text NOT NULL,
  -- Marker plus the first characters of the secret, safe to show.
  secret_prefix text NOT NULL,
  -- What the device last reported about the machine: os, arch, cpus,
  -- memoryBytes, dockerVersion. Display only.
  platform jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The release the device's spawner runs, as of its last ticket.
  version text,
  -- How many sandboxes the device offers at once (its own admission cap).
  max_sessions integer,
  -- The admin whose join token enrolled the device.
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  -- Stamped when the device mints a ticket (every few minutes while it runs).
  last_seen_at_ms bigint,
  revoked_at_ms bigint,
  -- A user id, or `device` when the machine disconnected itself.
  revoked_by text,
  -- Stamped once the hub confirmed it dropped a removed device (tunnel
  -- closed, placements forgotten). The removal asks at once; when the
  -- spawner cannot be reached the sandbox watchdog asks again, because a
  -- placement left behind would answer "device offline" for its sessions
  -- forever.
  hub_released_at_ms bigint
);

-- The door's reverse lookup — one row per secret, ever.
CREATE UNIQUE INDEX sandbox_devices_secret_hash
  ON app.sandbox_devices (secret_hash);
-- The settings list, newest first.
CREATE INDEX sandbox_devices_org
  ON app.sandbox_devices (org_id, created_at_ms DESC);
-- The watchdog's retry queue: removed, not yet released by the hub.
CREATE INDEX sandbox_devices_hub_release_pending
  ON app.sandbox_devices (revoked_at_ms)
  WHERE revoked_at_ms IS NOT NULL AND hub_released_at_ms IS NULL;

CREATE TABLE app.sandbox_device_join_tokens (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- SHA-256 (hex) of the join token; the plaintext lives only in the command
  -- the admin copied.
  token_hash text NOT NULL,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  -- Stamped by the join that spent the token; a spent token never joins again.
  used_at_ms bigint,
  device_id text
);

CREATE UNIQUE INDEX sandbox_device_join_tokens_hash
  ON app.sandbox_device_join_tokens (token_hash);
-- The per-organization cap on live (unspent, unexpired) tokens.
CREATE INDEX sandbox_device_join_tokens_org
  ON app.sandbox_device_join_tokens (org_id, expires_at_ms DESC);
