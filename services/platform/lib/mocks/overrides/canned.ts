/**
 * Deterministic content streamed by the chat-completions override, shared
 * between the override producer (`chat-completions.ts`) and the chat specs
 * (assertions) so the two can never drift.
 *
 * The default reply is `CANNED_REPLY`. The remaining constants drive the
 * keyword-gated "scenario" branches: a user message containing one of
 * `MOCK_TRIGGERS` makes the mock emit a richer stream (reasoning, structured
 * next-steps, or a tool call) instead of the plain canned reply. Messages with
 * no trigger keyword always get `CANNED_REPLY` verbatim, so the default-path
 * specs (chat / chat-threads / chat-advanced / …) are unaffected.
 *
 */

/** The default assistant reply for any message with no trigger keyword. */
export const CANNED_REPLY =
  'Hello from the Tale E2E mock assistant. This reply is canned and deterministic.';

/**
 * Substrings that switch the mock into a scenario. A user message containing
 * one of these (case-insensitive) triggers the matching branch. Kept lowercase
 * and prefixed so they can never collide with the default-path specs' messages.
 *
 * Three of them stand in for the ways a real model ends a streamed reply
 * without an answer, which the chat must settle and explain rather than keep
 * "thinking" over:
 *
 *  - `empty` — the stream finishes with `stop` without writing a word.
 *  - `length` — `CANNED_REASONING` streams, then the stream finishes with
 *    `length` before any content: the whole output limit spent thinking.
 *  - `streamError` — the stream opens with a `200`, then carries an error
 *    event, the shape OpenRouter documents for a failure after a response
 *    has started (`error` beside a choice whose `finish_reason` is `error`).
 */
export const MOCK_TRIGGERS = {
  reasoning: 'e2e:reasoning',
  error: 'e2e:error',
  empty: 'e2e:empty',
  length: 'e2e:length',
  streamError: 'e2e:stream-error',
  gatewayRoute: 'e2e:gateway-route',
  cloudRegion: 'e2e:cloud-region',
} as const;

/**
 * Serving scenarios (`MOCK_TRIGGERS.gatewayRoute` / `cloudRegion`): the
 * canned reply, streamed with what a provider says about where it served it.
 * A gateway route names the upstream on every chunk, the way OpenRouter's
 * top-level `provider` does; a cloud region names the region in a response
 * header, the way Azure OpenAI's `x-ms-region` does. Both report a model id
 * that differs from the requested one (a dated snapshot), as a provider
 * resolving an alias or a deployment name does.
 */
export const MOCK_SERVING = {
  upstream: 'Anthropic',
  region: 'Switzerland North',
  modelSuffix: '-20260115',
} as const;

/**
 * Error scenario (`MOCK_TRIGGERS.error`): the generation call returns an HTTP
 * 500 so the chat surfaces its provider-failure UI. Only the streaming
 * generation call fails — the JSON router/title calls still get the canned
 * `{}`, so the failure lands on the assistant turn, not on routing.
 */
export const CANNED_ERROR_MESSAGE = 'E2E induced provider error';

/** The message of the error event the `streamError` scenario streams. */
export const CANNED_STREAM_ERROR_MESSAGE =
  'E2E induced provider error inside the stream';

/**
 * Reasoning scenario (`MOCK_TRIGGERS.reasoning`): streamed first as
 * `delta.reasoning_content` (→ a "Thinking" disclosure), then the answer as
 * normal `delta.content`.
 */
export const CANNED_REASONING =
  'Let me think through this step by step before answering.';
export const CANNED_REASONING_ANSWER =
  'Based on that reasoning, here is the deterministic answer.';
