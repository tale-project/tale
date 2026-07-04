// buildExec snapshot/contract tests. The argv + env are security-relevant
// strings (they wire the agent to the gateway and carry the session key), so
// they're asserted exactly.

import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claude-code/adapter';
import { CursorAdapter } from './cursor/adapter';
import type { AgentRunSpec } from './types';

const base = {
  prompt: 'Fix issue #1 and open a PR',
  model: 'claude-sonnet-4-6',
  gateway: { baseUrl: 'http://sandbox-llm-gateway:8080', token: 'sk-bf-test' },
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
    // Managed runs default to the 1M window via the `[1m]` marker (CC strips it
    // before the API call, so the gateway VK allowlist still sees the bare id).
    expect(argv).toContain('claude-sonnet-4-6[1m]');
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
    // Built-in AskUserQuestion is always denied (no answer path in chat), plus
    // WebSearch AND WebFetch on managed runs — both model-coupled and ungoverned,
    // so ALL web access routes through a connected integration via the dispatch
    // bridge (search op + extract/fetch op), audited and wrapped.
    expect(argv).toContain('--disallowedTools');
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe(
      'AskUserQuestion,WebSearch,WebFetch',
    );
    // prompt rides stdin as ONE stream-json user-message NDJSON line (a
    // malformed line kills the CLI's stream-json reader), never argv. Managed
    // runs prepend the `Ultrathink:` keyword for max reasoning depth.
    expect(stdin).toBe(`${stdin?.trimEnd()}\n`);
    expect(JSON.parse(stdin ?? '')).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `Ultrathink: ${base.prompt}` }],
      },
    });
    expect(argv).not.toContain(base.prompt);
    // gateway env + key + blanked API key + default-model slots.
    expect(env.ANTHROPIC_BASE_URL).toBe(
      'http://sandbox-llm-gateway:8080/anthropic',
    );
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bf-test');
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/user/.runtime/home/.claude');
    // Every alias tier plus the subagent override pins to the selected model:
    // the session VK only allows that one model, so any other resolution
    // would be rejected at the gateway. ANTHROPIC_MODEL covers the CLI's
    // internal default-model paths (queued-message replay ignores --model).
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6[1m]');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('claude-sonnet-4-6');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-4-6');
    expect(cwd).toBe('/user/workspace');
  });

  it('grants out-of-cwd dirs via --add-dir (chat attachment staging)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      additionalDirs: ['/user/uploads'],
    });
    const i = argv.indexOf('--add-dir');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('/user/uploads');
  });

  it('omits --add-dir when no additional dirs are requested', () => {
    expect(new ClaudeCodeAdapter().buildExec(base).argv).not.toContain(
      '--add-dir',
    );
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

  it('does not arm the vision-read hook unless visionTool is set', () => {
    const { env } = new ClaudeCodeAdapter().buildExec(base);
    // The hook self-gates on TALE_VISION_MODEL; absent ⇒ it is a no-op.
    expect(env.TALE_VISION_MODEL).toBeUndefined();
    expect(env.TALE_GATEWAY_URL).toBeUndefined();
  });

  it('arms the vision-read hook (gateway + key + model env) when visionTool is set', () => {
    const { env } = new ClaudeCodeAdapter().buildExec({
      ...base,
      visionTool: true,
      visionModel: 'openrouter:qwen/qwen3-vl-32b-instruct',
    });
    // The tale-vision-read-hook (managed-settings.json) transcribes through the
    // SAME gateway the agent uses, with the session key, using these env vars.
    expect(env.TALE_GATEWAY_URL).toBe('http://sandbox-llm-gateway:8080');
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(env.TALE_VISION_MODEL).toBe('openrouter:qwen/qwen3-vl-32b-instruct');
  });

  it('forces browser screenshots to disk (--image-responses omit) for a text-only agent', () => {
    const withVision = new ClaudeCodeAdapter().buildExec({
      ...base,
      visionTool: true,
      visionModel: 'openrouter:qwen/qwen3-vl-32b-instruct',
    });
    const pw = JSON.parse(
      withVision.argv[withVision.argv.indexOf('--mcp-config') + 1] ?? '{}',
    ).mcpServers.playwright;
    // Inline screenshots bypass the Read hook and 404 the text-only model; omit
    // saves them to disk so they route through Read → the vision hook.
    expect(pw.args).toContain('--image-responses');
    expect(pw.args).toContain('omit');
    // A vision-capable agent keeps inline images (no omit).
    const noVision = new ClaudeCodeAdapter().buildExec(base);
    const pw2 = JSON.parse(
      noVision.argv[noVision.argv.indexOf('--mcp-config') + 1] ?? '{}',
    ).mcpServers.playwright;
    expect(pw2.args).not.toContain('--image-responses');
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

  it('gates the human-control MCP server off for autonomous runs (no human to take over)', () => {
    const interactive = new ClaudeCodeAdapter().buildExec({
      ...base,
      browserCdp: true,
      interactionMode: 'interactive',
    });
    const interactiveMcp = JSON.parse(
      interactive.argv[interactive.argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    expect(interactiveMcp.mcpServers.humanControl).toBeDefined();

    const autonomous = new ClaudeCodeAdapter().buildExec({
      ...base,
      browserCdp: true,
      interactionMode: 'autonomous',
    });
    const autonomousMcp = JSON.parse(
      autonomous.argv[autonomous.argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    expect(autonomousMcp.mcpServers.humanControl).toBeUndefined();
    // Playwright is still attached — an autonomous run can still drive the browser.
    expect(autonomousMcp.mcpServers.playwright).toBeDefined();
  });

  it('denies AskUserQuestion in autonomous mode too (unchanged deny list)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      interactionMode: 'autonomous',
    });
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe(
      'AskUserQuestion,WebSearch,WebFetch',
    );
  });

  it('lifts the WebSearch/WebFetch denial for a managed agent that opts in via nativeWebTools', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      nativeWebTools: true,
    });
    // Only AskUserQuestion remains denied (no chat answer path); the web tools
    // are now the agent's native ones.
    expect(argv).toContain('--disallowedTools');
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
  });

  it('keeps the managed web-tools denial when nativeWebTools is explicitly false (only === true lifts it)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...base,
      nativeWebTools: false,
    });
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe(
      'AskUserQuestion,WebSearch,WebFetch',
    );
  });
});

describe('ClaudeCodeAdapter.buildExec — BYO mode', () => {
  // BYO carries NO gateway: the agent authenticates with the user-injected
  // session credentials, so the platform injects none of the gateway env.
  const byoBase: AgentRunSpec = {
    prompt: 'Fix issue #1',
    model: 'claude-opus-4-8',
    authMode: 'byo',
    workdir: '/user/workspace',
  };

  it('injects no gateway / key env; applies the 1M window like every session', () => {
    const { argv, env } = new ClaudeCodeAdapter().buildExec(byoBase);
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    // Not blanked to '' either — the user's own ANTHROPIC_API_KEY (if set in
    // the session env) must win via Claude Code's own credential precedence.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // No gateway-slug resolution, but the 1M window default applies to EVERY
    // session: the `[1m]` marker is stripped before the API call, so the user's
    // own provider still receives the bare model id.
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-8[1m]');
    expect(argv).toContain('--model');
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-4-8[1m]');
    // Box config still set; nonessential traffic still disabled.
    expect(env.CLAUDE_CONFIG_DIR).toBe('/user/.runtime/home/.claude');
  });

  it('does not pin the alias / subagent model slots (no VK allowlist to satisfy)', () => {
    const { env } = new ClaudeCodeAdapter().buildExec(byoBase);
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it('lifts the governance-motivated WebSearch/WebFetch denial but still denies AskUserQuestion (no chat answer path)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec(byoBase);
    // BYO opts out of governance (web tools enabled) but AskUserQuestion has no
    // answer path in chat regardless of credential mode, so it stays denied.
    expect(argv).toContain('--disallowedTools');
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
  });

  it('stays native for BYO even when nativeWebTools is false (the flag is a managed-only lift, never a byo re-deny)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...byoBase,
      nativeWebTools: false,
    });
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
  });

  it('omits the integration bridge even if integrationsBaseUrl is set (no session key to auth it)', () => {
    const { argv } = new ClaudeCodeAdapter().buildExec({
      ...byoBase,
      integrationsBaseUrl: 'http://proxy/api/integrations',
    });
    const mcpConfig = JSON.parse(
      argv[argv.indexOf('--mcp-config') + 1] ?? '{}',
    );
    expect(mcpConfig.mcpServers?.integrations).toBeUndefined();
  });

  it('managed mode is unaffected — gateway env injected and web tools denied', () => {
    const { argv, env } = new ClaudeCodeAdapter().buildExec({
      ...byoBase,
      authMode: 'managed',
      gateway: {
        baseUrl: 'http://sandbox-llm-gateway:8080',
        token: 'sk-bf-test',
      },
    });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bf-test');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
    expect(argv).toContain('--disallowedTools');
  });
});

describe('CursorAdapter.buildExec', () => {
  const cursorBase = {
    prompt: 'Fix issue #1 and open a PR',
    model: 'composer-2.5',
    workdir: '/user/workspace',
  } satisfies AgentRunSpec;

  it('builds headless stream-json invocation without gateway env', () => {
    const { argv, env, cwd, stdin, stdinMode } = new CursorAdapter().buildExec(
      cursorBase,
    );
    expect(argv.slice(0, 12)).toEqual([
      'agent',
      '-p',
      '--force',
      '--trust',
      '--sandbox',
      'disabled',
      '--output-format',
      'stream-json',
      '--workspace',
      '/user/workspace',
      '--max-turns',
      '200',
    ]);
    expect(argv[argv.length - 1]).toBe(cursorBase.prompt);
    expect(stdin).toBeUndefined();
    expect(stdinMode).toBe('close');
    expect(env).toEqual({});
    expect(argv).toContain('--model');
    expect(argv).toContain('composer-2.5');
    expect(cwd).toBe('/user/workspace');
  });

  it('continues a session with --resume and omits --model when unset', () => {
    const { argv } = new CursorAdapter().buildExec({
      ...cursorBase,
      agentSessionId: 'cur_ses_abc',
      model: undefined,
    });
    expect(argv).toContain('--resume');
    expect(argv).toContain('cur_ses_abc');
    expect(argv).not.toContain('--model');
  });
});
