-- The request id a caller was answered with, on a guardrail event.
--
-- A request through the model endpoints for API keys records its guardrail
-- verdicts in `app.chat_filter_events` under `thread_id =
-- 'model-api:<id>'`, where the id is the server's own for that request (the
-- op row's `exec_id`), which no caller can choose. The `X-Request-Id` the
-- caller receives is a different value — the REST door keeps an inbound id
-- a client or the proxy sent — so it is kept here, beside the key, for an
-- admin matching a caller's ticket to its events. NULL for every chat turn
-- and for rows written before this release. Rolling-deploy safe: nullable,
-- and the previous image names its insert columns.

ALTER TABLE app.chat_filter_events
  ADD COLUMN IF NOT EXISTS request_id text;
