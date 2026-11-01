-- The personal API keys an organization has blocked for itself.
--
-- A person's own key (one with no `app.api_key_owners` row, 0154) works in
-- every organization they are a member of. An Owner or Admin of one of
-- them may block such a key there and only there: the REST door refuses the
-- key's requests against this organization (`API_KEY_BLOCKED`,
-- `backend/rest/v1.ts`, reading `domains/api_keys/block-check.ts`), while
-- the key keeps working in the holder's other organizations and the holder
-- keeps it. Lifting the block deletes the row; the audit log keeps who
-- blocked and who lifted it (`domains/api_keys/blocks.ts`).
--
-- `api_key_id` carries no foreign key: Better Auth creates `"apikey"` after
-- the numbered migrations run, and deletes an expired key on its own. A row
-- whose key is gone blocks nothing, since no request can carry that key.
-- `holder_user_id` is the person whose key it is (`apikey.referenceId`),
-- kept so that the row names whose key it blocks without reading the key,
-- which may already be gone.
--
-- Deleting the organization deletes its rows with every other `app` table
-- keyed by `org_id` (`domains/organizations/service.ts`).
--
-- Rolling-deploy safe: a new table the previous image never reads. While the
-- previous image still serves, a block made on the new one does not stop the
-- key on the old one; the block holds from the moment the roll ends.

CREATE TABLE IF NOT EXISTS app.api_key_org_blocks (
  org_id text NOT NULL,
  -- The Better Auth `apikey.id` of the blocked personal key.
  api_key_id text NOT NULL,
  -- Whose key it is: the key's `referenceId`, a member of this organization.
  holder_user_id text NOT NULL,
  blocked_by text NOT NULL,
  blocked_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, api_key_id)
);

-- A refusal names the organizations where the key still works, so the door
-- reads one key's blocks across every organization (`listBlockingOrgSlugs`);
-- every other read goes through the primary key.
CREATE INDEX IF NOT EXISTS api_key_org_blocks_key
  ON app.api_key_org_blocks (api_key_id);
