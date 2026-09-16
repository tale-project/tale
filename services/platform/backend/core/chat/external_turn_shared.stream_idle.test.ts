/**
 * The managed exec takes its stream idle budget from the gateway's own
 * setting: one value reaches both the provider config the gateway enforces
 * (`stream_idle_timeout_in_seconds`) and the Claude Code exec, whose own idle
 * watchdog would otherwise give up after 300 s and send the request again
 * while the gateway is still waiting on a slow upstream (a long local-model
 * prefill). Only the network is replaced.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { provisionProviders } from '../node_only/sandbox/llm_gateway_admin';
import { buildExternalTurnExec } from './external_turn_shared';

/** The provider config bodies one provisioning pass PUTs to the gateway. */
async function pushedProviderConfigs(): Promise<unknown[]> {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL, init?: RequestInit) => {
      if (
        init?.method === 'PUT' &&
        String(url).endsWith('/api/providers/openrouter') &&
        typeof init.body === 'string'
      ) {
        const body: unknown = JSON.parse(init.body);
        bodies.push(body);
      }
      // One answer serves the whole pass: no stored key yet, every write ok.
      return Promise.resolve(
        new Response(JSON.stringify({ keys: [] }), { status: 200 }),
      );
    }),
  );
  const failures = await provisionProviders('org_idle', [
    {
      name: 'openrouter',
      apiKey: 'key-idle',
      models: ['anthropic/claude-sonnet-5'],
    },
  ]);
  expect(failures).toEqual([]);
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the managed exec follows the gateway stream idle budget', () => {
  it.each([
    ['the default budget', undefined, 600, 600],
    ['an operator-raised budget', '1800', 1800, 1800],
    // A lowered idle budget keeps the request timeout at its 600 s floor,
    // and the harness still waits that long for an answer.
    ['an operator-lowered budget', '300', 300, 600],
  ] as const)(
    '%s reaches the gateway and the harness alike',
    async (_label, configured, seconds, requestSeconds) => {
      vi.stubEnv('SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD', 'pw-test');
      vi.stubEnv('SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', configured);
      // The pre-rename name is read as a fallback; keep the host shell's out.
      vi.stubEnv('LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS', undefined);

      expect(await pushedProviderConfigs()).toEqual([
        expect.objectContaining({
          network_config: expect.objectContaining({
            stream_idle_timeout_in_seconds: seconds,
            // A broken stream makes the harness fall back to a non-streaming
            // request, which only this timeout bounds.
            default_request_timeout_in_seconds: requestSeconds,
          }),
        }),
      ]);

      const exec = buildExternalTurnExec({
        harness: 'claude-code',
        gatewayModel: 'openrouter/anthropic/claude-sonnet-5',
        serving: { kind: 'gateway', token: 'sk-bf-idle' },
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
});
