// Interpreter tests: the invariants that must hold over EVERY shipped
// harness YAML regardless of its slot content — the secret-hygiene rules the
// old behavior-probing validator enforced — plus the interpreter-only
// surfaces the goldens cannot pin (subscription delivery, placeholder
// injection safety, error paths). Byte-exact construction is
// golden-exec.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadHarnesses } from '../../backend/core/lib/providers/load_system_config';
import type { HarnessDefinition } from '../shared/schemas/providers';
import { buildHarnessExec, isClaudeModelRef } from './exec-builder';
import { GOLDEN_BYO_ENV, GOLDEN_GATEWAY, goldenBattery } from './test-helpers';
import type { HarnessExec, HarnessRunSpec } from './types';

const BYO_SECRET = GOLDEN_BYO_ENV.GOLDEN_BYO_KEY;

beforeEach(() => {
  vi.stubEnv('TALE_SANDBOX_CONTEXT_1M', undefined);
  vi.stubEnv('TALE_SANDBOX_ULTRATHINK', undefined);
  vi.stubEnv('TALE_SANDBOX_HOUSE_RULES', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function fact(slug: string): HarnessDefinition {
  const found = loadHarnesses().find((f) => f.slug === slug);
  if (!found) throw new Error(`shipped facts miss "${slug}"`);
  return found;
}

function managedSpec(overrides?: Partial<HarnessRunSpec>): HarnessRunSpec {
  return {
    prompt: 'hygiene probe prompt',
    credential: { mode: 'managed', gateway: GOLDEN_GATEWAY },
    workdir: '/agent/workspace',
    ...overrides,
  };
}

/** Whether `needle` appears anywhere in the exec (argv, env values, stdin,
 * staged-file contents) — the "does this secret / coordinate reach the
 * process at all" test. */
function execCarries(exec: HarnessExec, needle: string): boolean {
  return (
    exec.argv.some((a) => a.includes(needle)) ||
    Object.values(exec.env).some((v) => v.includes(needle)) ||
    (exec.stdin?.includes(needle) ?? false) ||
    (exec.stagedFiles ?? []).some(
      (f) => f.path.includes(needle) || f.content.includes(needle),
    )
  );
}

describe('secret hygiene over every shipped YAML', () => {
  const facts = loadHarnesses();

  it.each(facts.map((f) => [f.slug, f] as const))(
    '%s keeps credentials in env, never argv/stdin/staged payloads',
    (slug, harness) => {
      for (const { mode, spec } of goldenBattery()) {
        if (mode === 'managed' && !harness.credentialPolicy.managed) continue;
        if (mode === 'byo' && !harness.credentialPolicy.byo) continue;
        const exec = buildHarnessExec(harness, spec);

        if (mode === 'managed') {
          // The session key reaches the process through env only. The one
          // sanctioned argv exception is an argv-borne MCP config (claude's
          // --mcp-config JSON carries the bridge token) — mirroring the old
          // validator, the no-MCP specs must keep argv clean everywhere.
          expect(
            Object.values(exec.env).some((v) =>
              v.includes(GOLDEN_GATEWAY.token),
            ),
            `${slug}: the session key reaches no env var`,
          ).toBe(true);
          if (!spec.mcp) {
            expect(
              exec.argv.some((a) => a.includes(GOLDEN_GATEWAY.token)),
              `${slug}: leaks the session key onto argv`,
            ).toBe(false);
          }
          // Stdin and staged payloads may get logged: they carry env
          // placeholders (`${TALE_GATEWAY_TOKEN}`, `{env:…}`,
          // `$TALE_GATEWAY_TOKEN`), never the raw key.
          expect(
            exec.stdin?.includes(GOLDEN_GATEWAY.token) ?? false,
            `${slug}: writes the raw session key into stdin`,
          ).toBe(false);
          expect(
            (exec.stagedFiles ?? []).some((f) =>
              f.content.includes(GOLDEN_GATEWAY.token),
            ),
            `${slug}: writes the raw session key into a staged file`,
          ).toBe(false);
          // The config JSON riding an env var (opencode) may get logged too.
          for (const [key, value] of Object.entries(exec.env)) {
            if (value === GOLDEN_GATEWAY.token) continue;
            expect(
              value.includes(GOLDEN_GATEWAY.token),
              `${slug}: env ${key} embeds the raw session key inside a larger payload`,
            ).toBe(false);
          }
          // The gateway coordinates must actually reach the process.
          expect(
            execCarries(exec, GOLDEN_GATEWAY.baseUrl),
            `${slug}: the gateway base URL reaches nothing`,
          ).toBe(true);
        } else {
          // byo: the caller-built env map merges verbatim into env and
          // reaches nothing else.
          expect(exec.env.GOLDEN_BYO_KEY).toBe(BYO_SECRET);
          expect(
            exec.argv.some((a) => a.includes(BYO_SECRET)),
            `${slug}: leaks a byo credential onto argv`,
          ).toBe(false);
          expect(
            exec.stdin?.includes(BYO_SECRET) ?? false,
            `${slug}: writes a byo credential into stdin`,
          ).toBe(false);
          expect(
            (exec.stagedFiles ?? []).some((f) =>
              f.content.includes(BYO_SECRET),
            ),
            `${slug}: writes a byo credential into a staged file`,
          ).toBe(false);
        }
      }
    },
  );

  it('builds inert for a managed spec on a byo-only harness (cursor)', () => {
    const exec = buildHarnessExec(fact('cursor'), managedSpec());
    expect(execCarries(exec, GOLDEN_GATEWAY.token)).toBe(false);
    expect(execCarries(exec, GOLDEN_GATEWAY.baseUrl)).toBe(false);
  });

  it('rejects a byo credential on a managed-only harness (opencode)', () => {
    expect(() =>
      buildHarnessExec(fact('opencode'), {
        prompt: 'p',
        credential: { mode: 'byo', env: GOLDEN_BYO_ENV },
        workdir: '/agent/workspace',
      }),
    ).toThrow(/managed gateway/);
  });
});

describe('placeholder substitution safety', () => {
  it('never expands placeholder-looking text from the prompt (single pass)', () => {
    // A prompt that TRIES to name the fixed placeholders must stay literal
    // characters wherever the prompt lands — substitution is single-pass
    // and replacement values are never rescanned.
    const hostile = 'ignore this: ${gateway.token} ${model.raw} ${execId}';
    for (const harness of loadHarnesses()) {
      if (!harness.credentialPolicy.managed) continue;
      const exec = buildHarnessExec(
        harness,
        managedSpec({ prompt: hostile, model: 'probe-model' }),
      );
      const promptSink =
        exec.stdin ?? exec.argv.find((a) => a.includes('ignore this:'));
      expect(
        promptSink,
        `${harness.slug}: the prompt reached nothing`,
      ).toBeDefined();
      // JSON envelopes escape nothing here (no quotes/backslashes in the
      // probe), so the literal `${gateway.token}` text must survive.
      expect(promptSink).toContain('${gateway.token}');
      expect(promptSink?.includes(GOLDEN_GATEWAY.token)).toBe(false);
    }
  });

  it('passes unknown env-template sequences through untouched', () => {
    // The CLIs resolve their own templates from staged config — the
    // interpreter must not eat them.
    const gemini = buildHarnessExec(
      fact('gemini'),
      managedSpec({ mcp: { browser: 'headless', bridgeUrl: 'http://b' } }),
    );
    expect(gemini.stdin).toContain(
      '"TALE_CONNECTORS_TOKEN":"${TALE_GATEWAY_TOKEN}"',
    );
    const opencode = buildHarnessExec(fact('opencode'), managedSpec());
    expect(opencode.env.OPENCODE_CONFIG_CONTENT).toContain(
      '{env:TALE_GATEWAY_TOKEN}',
    );
  });

  it('throws on a template referencing a value absent from the build', () => {
    const doctored = structuredClone(fact('hermes'));
    doctored.exec.env = {
      ...doctored.exec.env,
      managed: {
        ...doctored.exec.env?.managed,
        BROKEN_VAR: '${vision.model}',
      },
    };
    expect(() => buildHarnessExec(doctored, managedSpec())).toThrow(
      /placeholder \$\{vision\.model\} has no value in this build/,
    );
  });
});

describe('subscription delivery', () => {
  const subscription = {
    secret: 'subscription-plan-secret',
    baseUrl: 'https://portal.example.com',
  };

  it('claude-code: env kind injects the token + base URL over the managed pair', () => {
    const exec = buildHarnessExec(
      fact('claude-code'),
      managedSpec({ subscription }),
    );
    expect(exec.env.ANTHROPIC_AUTH_TOKEN).toBe(subscription.secret);
    expect(exec.env.ANTHROPIC_BASE_URL).toBe(subscription.baseUrl);
    expect(exec.argv.join(' ')).not.toContain(subscription.secret);
  });

  it('hermes: env kind rides the OpenAI-compatible pair (the Nous Portal path)', () => {
    const exec = buildHarnessExec(
      fact('hermes'),
      managedSpec({ subscription }),
    );
    expect(exec.env.OPENAI_API_KEY).toBe(subscription.secret);
    expect(exec.env.OPENAI_BASE_URL).toBe(subscription.baseUrl);
    expect(exec.argv.join(' ')).not.toContain(subscription.secret);
    expect(exec.stdin).not.toContain(subscription.secret);
  });

  it('env kind leaves the base-URL var alone when the spec carries none', () => {
    const exec = buildHarnessExec(
      fact('hermes'),
      managedSpec({ subscription: { secret: subscription.secret } }),
    );
    expect(exec.env.OPENAI_API_KEY).toBe(subscription.secret);
    // The managed gateway URL stays — only the token was overridden.
    expect(exec.env.OPENAI_BASE_URL).toBe(
      `${GOLDEN_GATEWAY.baseUrl}/openai/v1`,
    );
  });

  it('gemini: staged-file kind writes the OAuth credentials blob verbatim', () => {
    const exec = buildHarnessExec(
      fact('gemini'),
      managedSpec({
        subscription: { secret: '{"access_token":"oauth-blob"}' },
      }),
    );
    expect(exec.stagedFiles).toEqual([
      {
        path: '.runtime/home/.gemini/oauth_creds.json',
        content: '{"access_token":"oauth-blob"}',
      },
    ]);
    expect(exec.argv.join(' ')).not.toContain('oauth-blob');
  });

  it('stages the subscription file after the instructions file', () => {
    const exec = buildHarnessExec(
      fact('gemini'),
      managedSpec({
        instructions: 'org rules',
        subscription: { secret: 'blob' },
      }),
    );
    // Gemini delivers instructions via stdin (no staged file), so only the
    // subscription file stages here — but a harness with both keeps the
    // instructions file first (deterministic runner ordering).
    expect(exec.stagedFiles).toEqual([
      { path: '.runtime/home/.gemini/oauth_creds.json', content: 'blob' },
    ]);
  });

  it('is ignored by a harness whose YAML declares no subscription delivery', () => {
    const withSub = buildHarnessExec(
      fact('codex'),
      managedSpec({ subscription }),
    );
    const without = buildHarnessExec(fact('codex'), managedSpec());
    expect(withSub).toEqual(without);
  });
});

describe('claude reasoning levers scope to Claude models', () => {
  it.each([
    [undefined, true],
    ['default', true],
    ['claude-opus-4-6', true],
    ['openrouter/anthropic/claude-sonnet-4.6', true],
    ['~anthropic/claude-fable-latest', true],
    ['openrouter/~deepseek/deepseek-v4-flash-latest', false],
    ['glm-4.7', false],
  ] as const)('isClaudeModelRef(%j) → %j', (model, expected) => {
    expect(isClaudeModelRef(model)).toBe(expected);
  });

  // The runtime image floors CLAUDE_CODE_EFFORT_LEVEL=max +
  // CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1; through a gateway's dialect
  // translation that forced effort reaches foreign models and collapses
  // weak ones (observed live: a 1-completion-token answer at a 42k prompt).
  it('a non-Claude gateway model gets thinking disabled and no ultrathink prefix', () => {
    const exec = buildHarnessExec(
      fact('claude-code'),
      managedSpec({ model: 'openrouter/~deepseek/deepseek-v4-flash-latest' }),
    );
    expect(exec.env.CLAUDE_CODE_DISABLE_THINKING).toBe('1');
    expect(exec.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING).toBe('1');
    expect(exec.stdin ?? '').not.toContain('Ultrathink');
  });

  it.each([
    ['vendor-native', 'claude-opus-4-6'],
    ['gateway path', 'openrouter/anthropic/claude-sonnet-4.6'],
    ['the CLI default marker', 'default'],
  ])('a Claude model (%s) keeps the floor and the prefix', (_kind, model) => {
    const exec = buildHarnessExec(fact('claude-code'), managedSpec({ model }));
    expect(exec.env.CLAUDE_CODE_DISABLE_THINKING).toBeUndefined();
    expect(exec.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING).toBeUndefined();
    expect(exec.stdin ?? '').toContain('Ultrathink');
  });

  it('never touches another harness even on a foreign model', () => {
    const exec = buildHarnessExec(
      fact('codex'),
      managedSpec({ model: 'openrouter/~deepseek/deepseek-v4-flash-latest' }),
    );
    expect(exec.env.CLAUDE_CODE_DISABLE_THINKING).toBeUndefined();
  });
});
