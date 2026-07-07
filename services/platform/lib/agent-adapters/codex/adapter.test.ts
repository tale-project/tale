import { describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { CodexAdapter } from './adapter';

const adapter = new CodexAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'Fix the bug', workdir: '/user/workspace', ...overrides };
}

/** The -c overrides as `key=value` strings, for order-independent asserts. */
function configOverrides(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length - 1; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === '-c' && next !== undefined) out.push(next);
  }
  return out;
}

describe('CodexAdapter buildExec', () => {
  it('builds the managed gateway invocation (Responses API provider via -c)', () => {
    const { argv, env, cwd, stdin, stdinMode } = adapter.buildExec(
      baseSpec({
        model: 'openrouter/openai/gpt-5.5',
        gateway: {
          baseUrl: 'http://sandbox-llm-gateway:8080',
          token: 'sk-bf-test',
        },
      }),
    );
    expect(argv.slice(0, 4)).toEqual([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
    ]);
    const cfg = configOverrides(argv);
    expect(cfg).toContain('approval_policy="never"');
    expect(cfg).toContain('sandbox_mode="danger-full-access"');
    expect(cfg).toContain('model_provider="tale"');
    expect(cfg).toContain(
      'model_providers.tale.base_url="http://sandbox-llm-gateway:8080/openai/v1"',
    );
    // The bearer key is read from the session env — never on argv.
    expect(cfg).toContain('model_providers.tale.env_key="TALE_GATEWAY_TOKEN"');
    expect(cfg).toContain('model_providers.tale.wire_api="responses"');
    expect(argv.join(' ')).not.toContain('sk-bf-test');
    expect(env.TALE_GATEWAY_TOKEN).toBe('sk-bf-test');
    expect(env.CODEX_HOME).toBe('/user/.runtime/home/.codex');
    expect(argv).toContain('-m');
    expect(argv).toContain('openrouter/openai/gpt-5.5');
    expect(argv[argv.length - 1]).toBe('-');
    expect(stdin).toBe('Fix the bug');
    expect(stdinMode).toBe('close');
    expect(cwd).toBe('/user/workspace');
  });

  it('carries the prompt on stdin behind the `-` sentinel, never argv', () => {
    // REGRESSION GUARD: a positional prompt starting with '-' would parse as
    // a flag, and argv leaks to process lists. The `-` sentinel makes the
    // pinned CLI read the prompt from stdin (verified 0.142.5).
    const prompt = '--not-a-flag: summarize this repo';
    const { argv, stdin } = adapter.buildExec(baseSpec({ prompt }));
    expect(argv).not.toContain(prompt);
    expect(argv[argv.length - 1]).toBe('-');
    expect(stdin).toBe(prompt);
  });

  it('delivers systemPromptAppend via developer_instructions (never dropped)', () => {
    const { argv } = adapter.buildExec(
      baseSpec({ systemPromptAppend: 'Be terse.' }),
    );
    expect(configOverrides(argv)).toContain(
      'developer_instructions="Be terse."',
    );
  });

  it('managed runs deny native web search; nativeWebTools=true lifts it', () => {
    const managed = adapter.buildExec(
      baseSpec({
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-1' },
      }),
    );
    expect(configOverrides(managed.argv)).toContain('web_search="disabled"');

    const optIn = adapter.buildExec(
      baseSpec({
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-1' },
        nativeWebTools: true,
      }),
    );
    expect(configOverrides(optIn.argv)).not.toContain('web_search="disabled"');
  });

  it('resumes via the resume subcommand with the same -c posture', () => {
    const { argv, stdin } = adapter.buildExec(
      baseSpec({
        agentSessionId: '019f3b0c-4531-7313-877c-fd1078c809a4',
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-1' },
      }),
    );
    expect(argv.slice(0, 4)).toEqual([
      'codex',
      'exec',
      'resume',
      '019f3b0c-4531-7313-877c-fd1078c809a4',
    ]);
    // resume has no -s/--sandbox flag (verified 0.142.5) — posture must ride -c.
    expect(argv).not.toContain('--sandbox');
    expect(configOverrides(argv)).toContain(
      'sandbox_mode="danger-full-access"',
    );
    expect(argv[argv.length - 1]).toBe('-');
    expect(stdin).toBe('Fix the bug');
  });

  it('BYO targets OpenAI directly via OPENAI_API_KEY env_key, no gateway env, web tools native', () => {
    const { argv, env } = adapter.buildExec(
      baseSpec({ authMode: 'byo', model: 'gpt-5.5' }),
    );
    const cfg = configOverrides(argv);
    expect(cfg).toContain(
      'model_providers.tale.base_url="https://api.openai.com/v1"',
    );
    expect(cfg).toContain('model_providers.tale.env_key="OPENAI_API_KEY"');
    expect(cfg).not.toContain('web_search="disabled"');
    expect(env.TALE_GATEWAY_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined(); // user-injected, never synthesized
  });

  it('wires MCP servers via config with env_vars whitelist (session key off argv)', () => {
    const { argv, env } = adapter.buildExec(
      baseSpec({
        gateway: { baseUrl: 'http://gw:8080', token: 'sk-secret' },
        integrationsBaseUrl: 'http://platform/api/integrations',
      }),
    );
    const cfg = configOverrides(argv);
    expect(cfg).toContain(
      'mcp_servers.playwright.command="tale-playwright-mcp"',
    );
    expect(cfg).toContain(
      'mcp_servers.integrations.command="tale-integrations-mcp"',
    );
    expect(cfg).toContain(
      'mcp_servers.integrations.env_vars=["TALE_INTEGRATIONS_URL","TALE_INTEGRATIONS_TOKEN"]',
    );
    expect(argv.join(' ')).not.toContain('sk-secret');
    expect(env.TALE_INTEGRATIONS_URL).toBe('http://platform/api/integrations');
    expect(env.TALE_INTEGRATIONS_TOKEN).toBe('sk-secret');
  });

  it('browserMcp=false drops the Playwright MCP; browserCdp attaches over CDP', () => {
    const off = adapter.buildExec(baseSpec({ browserMcp: false }));
    expect(off.argv.join(' ')).not.toContain('mcp_servers.playwright');

    const cdp = adapter.buildExec(baseSpec({ browserCdp: true }));
    expect(configOverrides(cdp.argv)).toContain(
      'mcp_servers.playwright.args=["--cdp-endpoint","http://127.0.0.1:9222"]',
    );
  });
});
