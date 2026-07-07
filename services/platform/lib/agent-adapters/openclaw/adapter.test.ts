import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { OpenClawAdapter } from './adapter';

const adapter = new OpenClawAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

function stdinPayload(stdin: string | undefined): Record<string, unknown> {
  expect(stdin).toBeDefined();
  return JSON.parse(stdin ?? '{}') as Record<string, unknown>;
}

interface OpenClawConfigShape {
  agents?: {
    defaults?: {
      workspace?: string;
      skipBootstrap?: boolean;
      model?: { primary?: string; fallbacks?: string[] };
    };
  };
  tools?: { profile?: string; deny?: string[] };
  models?: {
    providers?: Record<
      string,
      {
        baseUrl?: string;
        apiKey?: string;
        api?: string;
        models?: Array<{ id?: string; cost?: Record<string, number> }>;
      }
    >;
  };
  mcp?: {
    servers?: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  };
}

function configOf(stdin: string | undefined): OpenClawConfigShape {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return stdinPayload(stdin).config as OpenClawConfigShape;
}

describe('OpenClawAdapter buildExec', () => {
  it('builds tale-openclaw-run with the gateway tale provider for managed runs', () => {
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
      'tale-openclaw-run',
      '--workdir',
      '/user/workspace',
    ]);
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(env.OPENCLAW_STATE_DIR).toBe('/user/.runtime/home/.openclaw');
    expect(cwd).toBe('/user/workspace');
    expect(stdinMode).toBe('close');
    const config = configOf(stdin);
    // The workspace doubles as the exec/file-tool cwd; skipBootstrap keeps
    // OpenClaw from seeding bootstrap files (or git-init) into it.
    expect(config.agents?.defaults?.workspace).toBe('/user/workspace');
    expect(config.agents?.defaults?.skipBootstrap).toBe(true);
    // Gateway model rides the generated `tale` provider (slashed ids survive:
    // OpenClaw splits provider/model at the FIRST slash).
    expect(config.agents?.defaults?.model?.primary).toBe(
      'tale/openrouter/anthropic/claude-sonnet-4.6',
    );
    const tale = config.models?.providers?.tale;
    expect(tale?.baseUrl).toBe('http://sandbox-llm-gateway:8080/openai/v1');
    expect(tale?.api).toBe('openai-completions');
    // The session key rides OpenClaw's `${…}` SecretInput env template, never
    // the config JSON itself (the staged file could get logged).
    expect(tale?.apiKey).toBe('${TALE_GATEWAY_TOKEN}');
    expect(JSON.stringify(config)).not.toContain('sk-bf-test');
    expect(tale?.models?.[0]?.id).toBe(
      'openrouter/anthropic/claude-sonnet-4.6',
    );
    // Zero-cost rows: the gateway meters authoritatively; no fabricated
    // client-side cost estimates.
    expect(tale?.models?.[0]?.cost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
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
    // workspace AGENTS.md bootstrap file (injected into the system prompt
    // every turn); silently dropping it would be a defect.
    expect(payload.system_prompt).toBe('Be terse.');
  });

  it('denies native web tools on managed runs and lifts the deny on opt-in', () => {
    const managed = configOf(
      adapter.buildExec(
        baseSpec({ gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' } }),
      ).stdin,
    );
    expect(managed.tools).toEqual({
      profile: 'coding',
      deny: ['web_search', 'web_fetch', 'x_search'],
    });

    const optIn = configOf(
      adapter.buildExec(
        baseSpec({
          nativeWebTools: true,
          gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
        }),
      ).stdin,
    );
    expect(optIn.tools).toEqual({ profile: 'coding' });
  });

  it('resumes a session and omits gateway env + provider + web deny for BYO', () => {
    const { argv, env, stdin } = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        model: 'anthropic/claude-sonnet-4.6',
        agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      }),
    );
    expect(argv).toContain('--resume');
    expect(argv).toContain('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(env.TALE_GATEWAY_TOKEN).toBeUndefined();
    const config = configOf(stdin);
    // BYO: no gateway provider — OpenClaw resolves the user-injected session
    // credentials natively; the model ref passes through un-prefixed and the
    // native toolset stays intact.
    expect(config.models).toBeUndefined();
    expect(config.agents?.defaults?.model?.primary).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    expect(config.tools).toEqual({ profile: 'coding' });
  });

  it('arms the native fallback chain for a managed fallback model (VK-allowed)', () => {
    const config = configOf(
      adapter.buildExec(
        baseSpec({
          model: 'anthropic/claude-fable-5',
          fallbackModel: 'anthropic/claude-opus-4-8',
          gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
        }),
      ).stdin,
    );
    expect(config.agents?.defaults?.model).toEqual({
      primary: 'tale/anthropic/claude-fable-5',
      fallbacks: ['tale/anthropic/claude-opus-4-8'],
    });
    // Both ids must exist on the tale provider or the fallback 404s.
    expect(config.models?.providers?.tale?.models?.map((m) => m.id)).toEqual([
      'anthropic/claude-fable-5',
      'anthropic/claude-opus-4-8',
    ]);
  });

  it('wires the MCP servers into the config (integrations token via placeholder)', () => {
    const config = configOf(
      adapter.buildExec(
        baseSpec({
          integrationsBaseUrl: 'http://platform:3000/api/integrations',
          gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
        }),
      ).stdin,
    );
    expect(config.mcp?.servers?.playwright?.command).toBe(
      'tale-playwright-mcp',
    );
    expect(config.mcp?.servers?.integrations?.command).toBe(
      'tale-integrations-mcp',
    );
    // The session key rides the ${…} placeholder the WRAPPER resolves at
    // stage time (OpenClaw passes MCP env verbatim, no template resolution) —
    // the payload crossing the exec API never carries the key.
    expect(
      config.mcp?.servers?.integrations?.env?.TALE_INTEGRATIONS_TOKEN,
    ).toBe('${TALE_GATEWAY_TOKEN}');
    expect(JSON.stringify(config)).not.toContain('sk-bf-1');
  });

  it('attaches Playwright over CDP when browserCdp is on, omits MCP when browserMcp is off', () => {
    const cdp = configOf(
      adapter.buildExec(baseSpec({ browserCdp: true })).stdin,
    );
    expect(cdp.mcp?.servers?.playwright?.args).toEqual([
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
    ]);

    const off = configOf(
      adapter.buildExec(baseSpec({ browserMcp: false })).stdin,
    );
    expect(off.mcp).toBeUndefined();
  });

  it('ignores maxTurns (no per-run turn cap in the pinned CLI)', () => {
    const { argv, stdin } = adapter.buildExec(baseSpec({ maxTurns: 40 }));
    expect(argv.join(' ')).not.toContain('40');
    expect(stdin).not.toContain('maxTurns');
  });
});
