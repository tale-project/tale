/**
 * Shared instructions for structured response markers.
 *
 * Automatically appended to the system prompt for all streaming agents
 * in generate_response.ts. This allows any agent that streams directly
 * to the user to produce structured output with section markers.
 *
 * Text lives in the prompt registry (`system.structured_response`). Part of the
 * cache-stable prefix — guarded byte-for-byte by the registry snapshot test.
 */

import { renderPrompt } from '../prompts/registry';

export const STRUCTURED_RESPONSE_INSTRUCTIONS = renderPrompt(
  'system.structured_response',
);
