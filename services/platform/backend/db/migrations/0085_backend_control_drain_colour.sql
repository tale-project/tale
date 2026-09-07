-- Scope the deploy drain to one deployment colour.
--
-- `app.backend_control` (0039) carries ONE `draining` flag for the whole
-- deployment, and every api replica reads it. That was right while the api
-- was a singleton rolled in place: the CLI set the flag, the chat doors
-- refused new turns, the container was recreated, the flag was cleared.
--
-- It is wrong the moment two colours of the api serve at once. A blue-green
-- flip starts the new colour, drains the OLD one, waits for its in-flight
-- generations, and only then cuts it out of DNS — but a deployment-wide flag
-- makes the NEW colour refuse chats for the whole drain window too, which is
-- exactly the outage the overlap exists to avoid.
--
-- `draining_colour` names which colour the drain is aimed at. A replica
-- refuses new turns only when it matches its own `TALE_COLOR`.
--
-- NULL keeps the old meaning — "every replica" — deliberately, and that is
-- what makes this rolling-deploy safe in both directions:
--   * an OLDER CLI drains a NEWER backend: it writes no colour, the column
--     stays NULL, and every replica drains exactly as before;
--   * a NEWER CLI drains an OLDER backend: the extra column is ignored and
--     the deployment-wide flag still applies.
-- It is also the correct behaviour for the tiers that are not colour-rolled.
ALTER TABLE app.backend_control
  ADD COLUMN IF NOT EXISTS draining_colour text;

COMMENT ON COLUMN app.backend_control.draining_colour IS
  'Deployment colour the drain targets (matched against a replica''s TALE_COLOR); NULL drains every replica.';
