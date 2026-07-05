import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { HermesAdapter } from './adapter';

const adapter = new HermesAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

describe('HermesAdapter buildExec', () => {
  it('builds tale-hermes-run with gateway env for managed runs', () => {
    const { argv, env, cwd, stdinMode } = adapter.buildExec(
      baseSpec({
        model: 'openrouter:anthropic/claude-sonnet-4.6',
        gateway: {
          baseUrl: 'http://sandbox-llm-gateway:8080',
          token: 'sk-bf-test',
        },
      }),
    );
    expect(argv.slice(0, 6)).toEqual([
      'tale-hermes-run',
      '--prompt',
      'Fix the bug',
      '--workdir',
      '/user/workspace',
      '--max-turns',
    ]);
    expect(argv).toContain('--model');
    expect(argv).toContain('openrouter:anthropic/claude-sonnet-4.6');
    expect(stdinMode).toBe('close');
    expect(env.OPENAI_BASE_URL).toBe(
      'http://sandbox-llm-gateway:8080/openai/v1',
    );
    expect(env.OPENAI_API_KEY).toBe('sk-bf-test');
    expect(env.HERMES_HOME).toBe('/user/.runtime/home/.hermes');
    expect(cwd).toBe('/user/workspace');
  });

  it('resumes a session and omits gateway env for BYO', () => {
    const { argv, env } = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        agentSessionId: '20260705_120006_hermes1',
      }),
    );
    expect(argv).toContain('--resume');
    expect(argv).toContain('20260705_120006_hermes1');
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
