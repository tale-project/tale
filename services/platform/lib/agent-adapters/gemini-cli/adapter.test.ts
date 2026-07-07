import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { GeminiCliAdapter } from './adapter';

const adapter = new GeminiCliAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

function stdinPayload(stdin: string | undefined): Record<string, unknown> {
  expect(stdin).toBeDefined();
  return JSON.parse(stdin ?? '{}') as Record<string, unknown>;
}

describe('GeminiCliAdapter buildExec', () => {
  it('builds tale-gemini-run with GenAI gateway env for managed runs', () => {
    const { argv, env, cwd, stdin, stdinMode } = adapter.buildExec(
      baseSpec({
        model: 'openrouter/google/gemini-3.1-pro-preview',
        gateway: {
          baseUrl: 'http://sandbox-llm-gateway:8080',
          token: 'sk-bf-test',
        },
      }),
    );
    expect(argv.slice(0, 3)).toEqual([
      'tale-gemini-run',
      '--workdir',
      '/user/workspace',
    ]);
    expect(argv).toContain('--model');
    expect(argv).toContain('openrouter/google/gemini-3.1-pro-preview');
    expect(env.GOOGLE_GEMINI_BASE_URL).toBe(
      'http://sandbox-llm-gateway:8080/genai',
    );
    expect(env.GEMINI_API_KEY).toBe('sk-bf-test');
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(cwd).toBe('/user/workspace');
    expect(stdinMode).toBe('close');
    const payload = stdinPayload(stdin);
    expect(payload.prompt).toBe('Fix the bug');
    const settings = payload.settings as Record<string, unknown>;
    // Managed pins the auth type: GOOGLE_GEMINI_BASE_URL alone selects the
    // "gateway" auth type, which headless auth validation rejects (0.49.0).
    expect(settings.security).toEqual({
      auth: { selectedType: 'gemini-api-key' },
    });
    expect(settings.privacy).toEqual({ usageStatisticsEnabled: false });
    expect(settings.model).toEqual({ maxSessionTurns: 200 });
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
    // The append must actually reach the agent — the wrapper stages it as a
    // per-exec context file; silently dropping it would be a defect.
    expect(payload.system_prompt).toBe('Be terse.');
  });

  it('denies native web tools on managed runs and lifts the deny on opt-in', () => {
    const managed = stdinPayload(
      adapter.buildExec(
        baseSpec({
          gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
        }),
      ).stdin,
    ).settings as Record<string, unknown>;
    expect(managed.tools).toEqual({
      exclude: ['google_web_search', 'web_fetch'],
    });

    const optIn = stdinPayload(
      adapter.buildExec(
        baseSpec({
          nativeWebTools: true,
          gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
        }),
      ).stdin,
    ).settings as Record<string, unknown>;
    expect(optIn.tools).toBeUndefined();
  });

  it('resumes a session and omits gateway env + web-tool denial for BYO', () => {
    const { argv, env, stdin } = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        agentSessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      }),
    );
    expect(argv).toContain('--resume');
    expect(argv).toContain('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(env.GOOGLE_GEMINI_BASE_URL).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    const settings = stdinPayload(stdin).settings as Record<string, unknown>;
    // BYO: no auth-type pin (env inference picks GEMINI_API_KEY or the
    // Vertex vars) and the native toolset stays intact.
    expect(settings.security).toBeUndefined();
    expect(settings.tools).toBeUndefined();
  });

  it('ignores fallbackModel (no availability-fallback chain in Gemini CLI)', () => {
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        model: 'openrouter/google/gemini-3.1-pro-preview',
        fallbackModel: 'openrouter/google/gemini-3-flash-preview',
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
      }),
    );
    expect(argv.join(' ')).not.toContain('gemini-3-flash-preview');
    expect(stdin).not.toContain('gemini-3-flash-preview');
  });

  it('grants additional dirs and wires the MCP servers into settings', () => {
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        additionalDirs: ['/user/uploads'],
        integrationsBaseUrl: 'http://platform:3000/api/integrations',
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-bf-1' },
      }),
    );
    expect(argv).toContain('--include-directories');
    expect(argv).toContain('/user/uploads');
    const settings = stdinPayload(stdin).settings as {
      mcpServers?: Record<
        string,
        { command?: string; env?: Record<string, string> }
      >;
    };
    expect(settings.mcpServers?.playwright?.command).toBe(
      'tale-playwright-mcp',
    );
    expect(settings.mcpServers?.integrations?.command).toBe(
      'tale-integrations-mcp',
    );
    // The session key rides ${…} env interpolation, never the settings JSON
    // itself (the staged file may get logged).
    expect(
      settings.mcpServers?.integrations?.env?.TALE_INTEGRATIONS_TOKEN,
    ).toBe('${TALE_GATEWAY_TOKEN}');
    expect(JSON.stringify(settings)).not.toContain('sk-bf-1');
  });
});
