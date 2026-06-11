// buildExec snapshot/contract tests. The argv + env are security-relevant
// strings (they wire the agent to the gateway and carry the session key), so
// they're asserted exactly.

import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claude_code/adapter';
import { OpenCodeAdapter } from './opencode/adapter';
import type { AgentRunSpec } from './types';

const base: AgentRunSpec = {
  prompt: 'Fix issue #1 and open a PR',
  model: 'claude-sonnet-4-6',
  gateway: { baseUrl: 'http://bifrost:8080', token: 'sk-bf-test' },
  workdir: '/workspace/repo',
};

describe('ClaudeCodeAdapter.buildExec', () => {
  it('builds the headless stream-json invocation with gateway env', () => {
    const { argv, env, cwd, stdin } = new ClaudeCodeAdapter().buildExec(base);
    expect(argv.slice(0, 9)).toEqual([
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'bypassPermissions',
      '--max-turns',
    ]);
    expect(argv).toContain('40'); // default max turns
    expect(argv).toContain('--model');
    expect(argv).toContain('claude-sonnet-4-6');
    // browser MCP on by default.
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('--strict-mcp-config');
    // prompt rides stdin, never argv.
    expect(stdin).toBe(base.prompt);
    expect(argv).not.toContain(base.prompt);
    // gateway env + key + blanked API key + default-model slots.
    expect(env.ANTHROPIC_BASE_URL).toBe('http://bifrost:8080/anthropic');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bf-test');
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/workspace/.home/.claude');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6');
    expect(cwd).toBe('/workspace/repo');
  });

  it('adds --resume when continuing a session and omits browser MCP when off', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      agentSessionId: 'sess-abc',
      browserMcp: false,
    });
    expect(argv).toContain('--resume');
    expect(argv).toContain('sess-abc');
    expect(argv).not.toContain('--mcp-config');
  });
});

describe('OpenCodeAdapter.buildExec', () => {
  it('builds run --format json with injected gateway provider config', () => {
    const { argv, env, cwd } = new OpenCodeAdapter().buildExec(base);
    expect(argv.slice(0, 6)).toEqual([
      'opencode',
      'run',
      '--format',
      'json',
      '--dir',
      '/workspace/repo',
    ]);
    expect(argv).toContain('-m');
    expect(argv).toContain('tale/claude-sonnet-4-6');
    // prompt is the trailing positional.
    expect(argv[argv.length - 1]).toBe(base.prompt);

    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    expect(config.model).toBe('tale/claude-sonnet-4-6');
    expect(config.permission).toBe('allow');
    expect(config.provider.tale.options.baseURL).toBe(
      'http://bifrost:8080/openai/v1',
    );
    // token referenced via {env:…}, not inlined into the (loggable) config.
    expect(config.provider.tale.options.apiKey).toBe(
      '{env:TALE_GATEWAY_TOKEN}',
    );
    expect(JSON.stringify(config)).not.toContain('sk-bf-test');
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(config.mcp.playwright).toBeDefined();
    expect(cwd).toBe('/workspace/repo');
  });

  it('continues a session with -s and drops MCP when browserMcp is false', () => {
    const { argv, env } = new OpenCodeAdapter().buildExec({
      ...base,
      agentSessionId: 'ses_xyz',
      browserMcp: false,
    });
    expect(argv).toContain('-s');
    expect(argv).toContain('ses_xyz');
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    expect(config.mcp).toBeUndefined();
  });
});
