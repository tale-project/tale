import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { HermesAdapter } from './adapter';

const adapter = new HermesAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

describe('HermesAdapter buildExec', () => {
  it('builds tale-hermes-run with gateway env for managed runs', () => {
    const { argv, env, cwd, stdin, stdinMode } = adapter.buildExec(
      baseSpec({
        model: 'openrouter:anthropic/claude-sonnet-4.6',
        gateway: {
          baseUrl: 'http://sandbox-llm-gateway:8080',
          token: 'sk-bf-test',
        },
      }),
    );
    expect(argv.slice(0, 3)).toEqual([
      'tale-hermes-run',
      '--workdir',
      '/user/workspace',
    ]);
    expect(argv).toContain('--max-turns');
    expect(argv).toContain('--model');
    expect(argv).toContain('openrouter:anthropic/claude-sonnet-4.6');
    expect(stdin).toBe(JSON.stringify({ prompt: 'Fix the bug' }));
    expect(stdinMode).toBe('close');
    expect(env.OPENAI_BASE_URL).toBe(
      'http://sandbox-llm-gateway:8080/openai/v1',
    );
    expect(env.OPENAI_API_KEY).toBe('sk-bf-test');
    expect(env.HERMES_HOME).toBe('/user/.runtime/home/.hermes');
    expect(cwd).toBe('/user/workspace');
  });

  it('carries prompt + system prompt on stdin, never argv (leading-dash safe)', () => {
    // REGRESSION GUARD: '--prompt <text>' on argv broke on prompts starting
    // with '-' (argparse read them as flags) and leaked the prompt to process
    // lists. The exec contract (types.ts) puts the prompt on stdin.
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        prompt: '--not-a-flag: summarize this repo',
        systemPromptAppend: 'Be terse.',
      }),
    );
    expect(argv).not.toContain('--prompt');
    expect(argv).not.toContain('--system-prompt');
    expect(argv).not.toContain('--not-a-flag: summarize this repo');
    expect(argv).not.toContain('Be terse.');
    expect(stdin).toBe(
      JSON.stringify({
        prompt: '--not-a-flag: summarize this repo',
        system_prompt: 'Be terse.',
      }),
    );
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
