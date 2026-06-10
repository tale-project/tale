/**
 * The deterministic assistant reply streamed by the mock LLM server.
 * Shared between `server.ts` (producer) and the chat spec (assertion) so the
 * two can never drift.
 */
export const CANNED_REPLY =
  'Hello from the Tale E2E mock assistant. This reply is canned and deterministic.';
