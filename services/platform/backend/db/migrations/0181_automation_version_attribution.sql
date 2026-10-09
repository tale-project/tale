-- Which door saved each automation version, with which key and client.
--
-- `created_by` names the person (or `api-key:<userId>`, `system:provisioning`)
-- but not the door: a version saved in the editor, uploaded as a package,
-- written by managed configuration or saved by a coding agent over MCP read
-- the same. The editor's "Now showing v6" and the version history need to say
-- "saved by Ada with Claude Code", and an agent reading `get_automation`
-- needs to tell its own versions from a person's.
--
-- `created_via` is the door: `app` (the editor and its wizard), `upload` (a
-- package), `mcp` (a coding agent), `rest` (reserved for a REST save),
-- `managed` (declarative configuration) or `system` (the shipped default
-- packs). `api_key_id` is the API key a keyed door authenticated with — the
-- id only, never the key; key ids are already on runs (`automation_runs`).
-- `client_name` is the name the agent's client gave itself — untrusted,
-- display only, cleaned by `displayClientName` (`lib/shared/client-name.ts`)
-- and at most 80 characters. None of the three is personal data: an erasure
-- keeps them (the person is in `created_by`).
--
-- Rolling-deploy safe: three nullable columns, no rewrite. A version the
-- previous image saves during the roll leaves them NULL, which every reader
-- treats as "unknown door".
ALTER TABLE app.automations
  ADD COLUMN IF NOT EXISTS created_via text
    CONSTRAINT automations_created_via_check
    CHECK (
      created_via IS NULL
      OR created_via IN ('app', 'upload', 'mcp', 'rest', 'managed', 'system')
    ),
  ADD COLUMN IF NOT EXISTS api_key_id text,
  ADD COLUMN IF NOT EXISTS client_name text
    CONSTRAINT automations_client_name_check
    CHECK (client_name IS NULL OR char_length(client_name) BETWEEN 1 AND 80);
