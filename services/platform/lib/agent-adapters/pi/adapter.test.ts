import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { PiAdapter } from './adapter';

const adapter = new PiAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

function stdinPayload(stdin: string | undefined): Record<string, unknown> {
  expect(stdin).toBeDefined();
  return JSON.parse(stdin ?? '{}') as Record<string, unknown>;
}

describe('PiAdapter buildExec', () => {
  it('builds tale-pi-run with a staged gateway provider for managed runs', () => {
    const { argv, env, cwd, stdin, stdinMode } = adapter.buildExec(
      baseSpec({
        model: 'openrouter/anthropic/claude-sonnet-4.6',
        gateway: {
          baseUrl: 'http://sandbox-llm-gateway:8080',
          token: 'sk-bf-test',
        },
      }),
    );
    expect(argv.slice(0, 3)).toEqual([
      'tale-pi-run',
      '--workdir',
      '/user/workspace',
    ]);
    expect(argv).toContain('--provider');
    expect(argv).toContain('tale-gateway');
    expect(argv).toContain('--model');
    expect(argv).toContain('openrouter/anthropic/claude-sonnet-4.6');
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(cwd).toBe('/user/workspace');
    expect(stdinMode).toBe('close');
    const payload = stdinPayload(stdin);
    expect(payload.prompt).toBe('Fix the bug');
    // Managed routes through a per-exec Pi custom provider on the gateway's
    // OpenAI-compatible route — staged by the wrapper as models.json.
    const models = payload.models as {
      providers: Record<
        string,
        { baseUrl: string; api: string; apiKey: string; models?: unknown }
      >;
    };
    expect(models.providers['tale-gateway']).toMatchObject({
      baseUrl: 'http://sandbox-llm-gateway:8080/openai/v1',
      api: 'openai-completions',
      apiKey: '$TALE_GATEWAY_TOKEN',
      models: [{ id: 'openrouter/anthropic/claude-sonnet-4.6' }],
    });
    // The session key rides $TALE_GATEWAY_TOKEN env interpolation, never the
    // staged JSON itself (the staged file may get logged).
    expect(stdin).not.toContain('sk-bf-test');
    expect(payload.settings).toEqual({ enableInstallTelemetry: false });
  });

  it('carries prompt + system prompt on stdin, never argv (leading-dash safe)', () => {
    // REGRESSION GUARD: a prompt on argv breaks on leading-dash prompts
    // (argparse reads them as flags) and leaks the prompt to process lists.
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        prompt: '--not-a-flag: summarize this repo',
        systemPromptAppend: 'Be terse.',
      }),
    );
    expect(argv.join(' ')).not.toContain('--not-a-flag');
    expect(argv.join(' ')).not.toContain('Be terse.');
    const payload = stdinPayload(stdin);
    expect(payload.prompt).toBe('--not-a-flag: summarize this repo');
    // The append must actually reach the agent — the wrapper stages it as the
    // per-exec APPEND_SYSTEM.md Pi auto-discovers; silently dropping it would
    // be a defect.
    expect(payload.system_prompt).toBe('Be terse.');
  });

  it('resumes a session and omits gateway config for BYO', () => {
    const { argv, env, stdin } = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        model: 'anthropic/claude-sonnet-4.6',
        agentSessionId: '0197f3c5-3f22-77e7-886f-2760868904b9',
      }),
    );
    expect(argv).toContain('--resume');
    expect(argv).toContain('0197f3c5-3f22-77e7-886f-2760868904b9');
    // BYO: Pi's own env inference picks the user's credentials and resolves
    // the model against its built-in catalog — no pinned provider, no
    // gateway env, no staged models.json.
    expect(argv).not.toContain('--provider');
    expect(argv).toContain('--model');
    expect(argv).toContain('anthropic/claude-sonnet-4.6');
    expect(env.TALE_GATEWAY_TOKEN).toBeUndefined();
    expect(stdinPayload(stdin).models).toBeUndefined();
  });

  it('ignores fallbackModel (no availability-fallback chain in Pi)', () => {
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        model: 'openrouter/anthropic/claude-sonnet-4.6',
        fallbackModel: 'openrouter/anthropic/claude-opus-4.8',
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
      }),
    );
    expect(argv.join(' ')).not.toContain('claude-opus-4.8');
    expect(stdin).not.toContain('claude-opus-4.8');
  });

  it("declares the 'catalog' BYO model-id dialect (OpenRouter-style ids)", () => {
    // Pi's built-in openrouter catalog speaks the Tale catalog's ids verbatim
    // (`anthropic/claude-sonnet-4.6` is a literal model id at v0.80.3) — the
    // vendor-native translation would resolve on a different provider.
    expect(adapter.credentialPolicy.byoModelIdSource).toBe('catalog');
    expect(adapter.credentialPolicy.supportsByo).toBe(true);
    expect(adapter.credentialPolicy.managedSource).toBe('gateway');
  });
});
