// buildExec snapshot/contract tests. The argv + env are security-relevant
// strings (they wire the agent to the gateway and carry the session key), so
// they're asserted exactly.

import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claude_code/adapter';
import { OpenCodeAdapter } from './opencode/adapter';
import type { AgentRunSpec } from './types';

const base = {
  prompt: 'Fix issue #1 and open a PR',
  model: 'claude-sonnet-4-6',
  gateway: { baseUrl: 'http://bifrost:8080', token: 'sk-bf-test' },
  workdir: '/user/workspace',
} satisfies AgentRunSpec;

describe('ClaudeCodeAdapter.buildExec', () => {
  it('builds the headless stream-json invocation with gateway env', () => {
    const { argv, env, cwd, stdin, stdinMode } =
      new ClaudeCodeAdapter().buildExec(base);
    expect(argv.slice(0, 11)).toEqual([
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'bypassPermissions',
      '--max-turns',
    ]);
    // stdin is held open for mid-run steering pushes; the drain closes it.
    expect(stdinMode).toBe('hold');
    expect(argv).toContain('200'); // default max turns (runaway backstop)
    expect(argv).toContain('--model');
    expect(argv).toContain('claude-sonnet-4-6');
    // browser MCP on by default: launcher shim + chromium + in-memory
    // profile (the registry path is read-only at runtime).
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('--strict-mcp-config');
    const mcpConfig = JSON.parse(
      argv[argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    expect(mcpConfig.mcpServers.playwright.command).toBe('tale-playwright-mcp');
    expect(mcpConfig.mcpServers.playwright.args).toEqual([
      '--headless',
      '--browser',
      'chromium',
      '--isolated',
      '--no-sandbox',
      '--ignore-https-errors',
    ]);
    // No integration bridge unless integrationsBaseUrl is set.
    expect(mcpConfig.mcpServers.integrations).toBeUndefined();
    // Built-in WebSearch AND WebFetch are denied — both are model-coupled and
    // ungoverned, so ALL web access routes through a connected integration via
    // the dispatch bridge (search op + extract/fetch op), audited and wrapped.
    expect(argv).toContain('--disallowedTools');
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe(
      'WebSearch,WebFetch',
    );
    // prompt rides stdin as ONE stream-json user-message NDJSON line (a
    // malformed line kills the CLI's stream-json reader), never argv.
    expect(stdin).toBe(`${stdin?.trimEnd()}\n`);
    expect(JSON.parse(stdin ?? '')).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: base.prompt }],
      },
    });
    expect(argv).not.toContain(base.prompt);
    // gateway env + key + blanked API key + default-model slots.
    expect(env.ANTHROPIC_BASE_URL).toBe('http://bifrost:8080/anthropic');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bf-test');
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/user/.runtime/home/.claude');
    // Every alias tier plus the subagent override pins to the selected model:
    // the session VK only allows that one model, so any other resolution
    // would be rejected at the gateway. ANTHROPIC_MODEL covers the CLI's
    // internal default-model paths (queued-message replay ignores --model).
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('claude-sonnet-4-6');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-4-6');
    expect(cwd).toBe('/user/workspace');
  });

  it('adds the integration MCP bridge (with URL + session key) when integrationsBaseUrl is set', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      integrationsBaseUrl: 'http://proxy/api/integrations',
    });
    const mcpConfig = JSON.parse(
      argv[argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    // Merged into the SAME --mcp-config as Playwright.
    expect(mcpConfig.mcpServers.playwright.command).toBe('tale-playwright-mcp');
    expect(mcpConfig.mcpServers.integrations.command).toBe(
      'tale-integrations-mcp',
    );
    expect(mcpConfig.mcpServers.integrations.env.TALE_INTEGRATIONS_URL).toBe(
      'http://proxy/api/integrations',
    );
    // The bridge carries the per-session key to auth the dispatch callbacks.
    expect(mcpConfig.mcpServers.integrations.env.TALE_INTEGRATIONS_TOKEN).toBe(
      'sk-bf-test',
    );
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

  it('attaches Playwright MCP over CDP (no headless self-launch flags) when browserCdp is on', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      browserCdp: true,
    });
    const mcpConfig = JSON.parse(
      argv[argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    // Still the same launcher shim, but now in CDP-attach mode: it connects to
    // the externally-launched headed Chromium on loopback 9222 (the read-only
    // mirror) instead of self-launching headless.
    expect(mcpConfig.mcpServers.playwright.command).toBe('tale-playwright-mcp');
    expect(mcpConfig.mcpServers.playwright.args).toEqual([
      '--cdp-endpoint',
      'http://127.0.0.1:9222',
    ]);
    // The self-launch flags belong to the now-externally-managed browser and
    // must be gone (connectOverCDP ignores launch options).
    const args: string[] = mcpConfig.mcpServers.playwright.args;
    for (const dropped of [
      '--headless',
      '--browser',
      'chromium',
      '--isolated',
      '--no-sandbox',
      '--ignore-https-errors',
    ]) {
      expect(args).not.toContain(dropped);
    }
  });

  it('keeps the headless self-launch args byte-identical when browserCdp is off/unset', () => {
    // Explicit-false and unset are both the default headless shape — proves the
    // CDP path is strictly additive and OFF is byte-identical to today.
    for (const spec of [{ ...base, browserCdp: false }, base]) {
      const { argv } = new ClaudeCodeAdapter().buildExec(spec);
      const mcpConfig = JSON.parse(
        argv[argv.indexOf('--mcp-config') + 1] ?? '{}',
      );
      expect(mcpConfig.mcpServers.playwright.args).toEqual([
        '--headless',
        '--browser',
        'chromium',
        '--isolated',
        '--no-sandbox',
        '--ignore-https-errors',
      ]);
    }
  });

  it('runs plan turns under --permission-mode plan, execute/default under bypassPermissions', () => {
    const plan = new ClaudeCodeAdapter().buildExec({
      ...base,
      permissionMode: 'plan',
    });
    expect(plan.argv[plan.argv.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(plan.argv).not.toContain('bypassPermissions');

    const execute = new ClaudeCodeAdapter().buildExec({
      ...base,
      permissionMode: 'execute',
    });
    expect(execute.argv[execute.argv.indexOf('--permission-mode') + 1]).toBe(
      'bypassPermissions',
    );

    const unset = new ClaudeCodeAdapter().buildExec(base);
    expect(unset.argv[unset.argv.indexOf('--permission-mode') + 1]).toBe(
      'bypassPermissions',
    );
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
      '/user/workspace',
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
    expect(config.mcp.playwright.command).toEqual([
      'tale-playwright-mcp',
      '--headless',
      '--browser',
      'chromium',
      '--isolated',
      '--no-sandbox',
      '--ignore-https-errors',
    ]);
    expect(cwd).toBe('/user/workspace');
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
