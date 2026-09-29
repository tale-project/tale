-- What a model-endpoint request's settlement needs beyond the gateway's own
-- figure.
--
-- A request through the model endpoints for API keys (`kind = 'model-api'`,
-- `domains/model_api`) is settled like a managed turn: the gateway's spend
-- on its virtual key is read, booked into `app.usage_ledger`, and the key is
-- deleted (`settleGatewayKey`). The gateway's figure alone is not enough for
-- every ending, so the request writes what the relay saw on its op row when
-- it ends, and every attempt that settles it — the request's own, the
-- reconcile job, the sandbox watchdog's sweep — reads it from there:
--
--  - `settle_after_ms`: the spend is not read before this moment. A whole
--    (non-streamed) answer whose caller hung up, or whose read failed, may
--    still be generating at the vendor: the gateway does not notice the
--    caller leaving and books the cost only when the vendor answers, up to
--    its request timeout. Reading (and deleting the key) earlier would book
--    nothing for a call the vendor bills.
--  - `floor_cents`: the least the request is booked at. The gateway drops
--    the partial usage of a stream that ends early, so a stream the caller
--    hung up on (or that broke off) could read 0 while the vendor billed the
--    prompt and every token relayed; this is that prompt and the output the
--    relay counted, at the model's catalog price. Booked as the larger of the
--    two figures.
--  - `expected_cents`: what a finished answer's reported usage costs at the
--    catalog price. A gateway reading of 0 while this is above zero means the
--    gateway has not booked the call yet (its accounting runs after the
--    answer): the settlement waits and retries, and past its grace books
--    this figure instead of nothing.
--  - `input_tokens` / `output_tokens`: the counts the relay read — reported
--    by the vendor, or counted on a stream that ended early — booked with the
--    spend by whichever attempt settles it; the reconcile paths used to book
--    the cost with no tokens.
--  - `reserved_tokens`: the tokens the request's hold claims (its prompt
--    estimate plus its output cap), counted by the in-flight holds against
--    token caps the way a chat turn's `app.generations.reserved_tokens` is.
--
-- All nullable, written only for `model-api` ops; a NULL reads as "no such
-- fact" (no wait, no floor, no expectation, no counts), which is what every
-- other op and every row written before this release means. No backfill.
-- Rolling-deploy safe: the previous image neither reads nor writes them.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS settle_after_ms bigint,
  ADD COLUMN IF NOT EXISTS floor_cents double precision,
  ADD COLUMN IF NOT EXISTS expected_cents double precision,
  ADD COLUMN IF NOT EXISTS input_tokens bigint,
  ADD COLUMN IF NOT EXISTS output_tokens bigint,
  ADD COLUMN IF NOT EXISTS reserved_tokens double precision;
