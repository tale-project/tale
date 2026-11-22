/**
 * The managed exec takes its stream idle budget from the model relay's own
 * setting: one value bounds the relay's wait between two chunks of a stream
 * and reaches the Claude Code exec, whose own idle watchdog would otherwise
 * give up after 300 s and send the request again while the relay is still
 * waiting on a slow upstream (a long local-model prefill).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestTimeoutSeconds,
  streamIdleSeconds,
} from '../../../lib/shared/model-relay-budget';
import { buildExternalTurnExec } from './external_turn_shared';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the managed exec follows the relay stream idle budget', () => {
  it.each([
    ['the default budget', undefined, 600, 600],
    ['an operator-raised budget', '1800', 1800, 1800],
    // A lowered idle budget keeps the request timeout at its 600 s floor,
    // and the harness still waits that long for an answer.
    ['an operator-lowered budget', '300', 300, 600],
    // A value that is no positive number reads as unset.
    ['a budget that is no number', 'soon', 600, 600],
  ] as const)(
    '%s reaches the relay and the harness alike',
    (_label, configured, seconds, requestSeconds) => {
      vi.stubEnv('SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', configured);
      // The pre-rename name is read as a fallback; keep the host shell's out.
      vi.stubEnv('LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', undefined);

      expect(streamIdleSeconds()).toBe(seconds);
      // A broken stream makes the harness fall back to a request that is
      // not streamed, which only this timeout bounds.
      expect(requestTimeoutSeconds()).toBe(requestSeconds);

      const exec = buildExternalTurnExec({
        harness: 'claude-code',
        gatewayModel: 'openrouter/anthropic/claude-sonnet-5',
        serving: { kind: 'gateway', token: 'tale-rt-idle' },
        instructions: '',
        prompt: 'Summarize the open tickets',
        execId: 'exec-idle',
      });
      expect(exec.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS).toBe(
        String(seconds * 1000),
      );
      expect(exec.env.API_TIMEOUT_MS).toBe(String(requestSeconds * 1000));
    },
  );

  it('reads the pre-rename name when the current one is not set', () => {
    vi.stubEnv('SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', undefined);
    vi.stubEnv('LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', '900');
    expect(streamIdleSeconds()).toBe(900);
    expect(requestTimeoutSeconds()).toBe(900);
  });
});
