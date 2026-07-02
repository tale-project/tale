// Max-context defaulting: the adapter appends Claude Code's `[1m]` window
// marker to the run model so the in-sandbox agent uses the full 1M context by
// default. CC strips the marker before the API call, so the gateway never sees
// it (verified against the 2.1.x binary: normalizeModelStringForAPI).

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRunSpec } from '../types';
import { ClaudeCodeAdapter } from './adapter';

const adapter = new ClaudeCodeAdapter();

function baseSpec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { prompt: 'hi', workdir: '/user/workspace', ...overrides };
}

function modelArg(argv: string[]): string | undefined {
  const i = argv.indexOf('--model');
  return i >= 0 ? argv[i + 1] : undefined;
}

function appendArg(argv: string[]): string | undefined {
  const i = argv.indexOf('--append-system-prompt');
  return i >= 0 ? argv[i + 1] : undefined;
}

function stdinText(stdin: string | undefined): string {
  return JSON.parse((stdin ?? '').trim()).message.content[0].text;
}

describe('ClaudeCodeAdapter buildExec — max context default', () => {
  const prev = process.env.TALE_SANDBOX_CONTEXT_1M;
  afterEach(() => {
    if (prev === undefined) delete process.env.TALE_SANDBOX_CONTEXT_1M;
    else process.env.TALE_SANDBOX_CONTEXT_1M = prev;
  });

  it('appends the [1m] window marker for Opus by default', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(baseSpec({ model: 'claude-opus-4-8' }));
    expect(modelArg(exec.argv)).toBe('claude-opus-4-8[1m]');
    expect(exec.env.ANTHROPIC_MODEL).toBe('claude-opus-4-8[1m]');
  });

  it('leaves Haiku (200K-only) untouched', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(baseSpec({ model: 'claude-haiku-4-5' }));
    expect(modelArg(exec.argv)).toBe('claude-haiku-4-5');
  });

  it('does not double-append when the model already carries [1m]', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(
      baseSpec({ model: 'claude-sonnet-4-6[1m]' }),
    );
    expect(modelArg(exec.argv)).toBe('claude-sonnet-4-6[1m]');
  });

  it('respects the TALE_SANDBOX_CONTEXT_1M=0 operator override', () => {
    process.env.TALE_SANDBOX_CONTEXT_1M = '0';
    const exec = adapter.buildExec(baseSpec({ model: 'claude-opus-4-8' }));
    expect(modelArg(exec.argv)).toBe('claude-opus-4-8');
    expect(exec.env.ANTHROPIC_MODEL).toBe('claude-opus-4-8');
  });

  it('keeps the alias model pins on the bare id and sets no effort env', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(baseSpec({ model: 'claude-opus-4-8' }));
    // The DEFAULT_*_MODEL pins resolve aliases against the VK's single allowed
    // model, so they must stay bare — the [1m] window rides on the run model.
    expect(exec.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
    // Reasoning effort is the sandbox image's overridable env floor, never the
    // per-exec overlay (which would clobber a user's session env value).
    expect(exec.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });
});

describe('ClaudeCodeAdapter buildExec — ultrathink prompt prefix', () => {
  const prev = process.env.TALE_SANDBOX_ULTRATHINK;
  afterEach(() => {
    if (prev === undefined) delete process.env.TALE_SANDBOX_ULTRATHINK;
    else process.env.TALE_SANDBOX_ULTRATHINK = prev;
  });

  it('prepends the Ultrathink keyword by default', () => {
    delete process.env.TALE_SANDBOX_ULTRATHINK;
    const exec = adapter.buildExec(baseSpec({ prompt: 'fix the bug' }));
    expect(stdinText(exec.stdin)).toBe('Ultrathink: fix the bug');
  });

  it('does not double-prepend when the prompt already says ultrathink', () => {
    delete process.env.TALE_SANDBOX_ULTRATHINK;
    const exec = adapter.buildExec(
      baseSpec({ prompt: 'ultrathink and fix it' }),
    );
    expect(stdinText(exec.stdin)).toBe('ultrathink and fix it');
  });

  it('respects the TALE_SANDBOX_ULTRATHINK=0 override', () => {
    process.env.TALE_SANDBOX_ULTRATHINK = '0';
    const exec = adapter.buildExec(baseSpec({ prompt: 'fix the bug' }));
    expect(stdinText(exec.stdin)).toBe('fix the bug');
  });

  it('applies to BYO sessions too (every session gets max defaults)', () => {
    delete process.env.TALE_SANDBOX_ULTRATHINK;
    const exec = adapter.buildExec(
      baseSpec({ prompt: 'fix the bug', authMode: 'byo' }),
    );
    expect(stdinText(exec.stdin)).toBe('Ultrathink: fix the bug');
  });
});

describe('ClaudeCodeAdapter buildExec — baseline house rules', () => {
  const prev = process.env.TALE_SANDBOX_HOUSE_RULES;
  afterEach(() => {
    if (prev === undefined) delete process.env.TALE_SANDBOX_HOUSE_RULES;
    else process.env.TALE_SANDBOX_HOUSE_RULES = prev;
  });

  it('appends the house rules to the system prompt by default', () => {
    delete process.env.TALE_SANDBOX_HOUSE_RULES;
    const append = appendArg(adapter.buildExec(baseSpec()).argv) ?? '';
    expect(append).toContain('Co-Authored-By');
    expect(append).toContain('Generated with Claude Code');
    expect(append).toContain('AGENTS.md');
    expect(append).toContain('empty catch block');
  });

  it('applies even when no per-agent system prompt was composed', () => {
    delete process.env.TALE_SANDBOX_HOUSE_RULES;
    // baseSpec carries no systemPromptAppend, yet the flag is still present.
    const exec = adapter.buildExec(baseSpec());
    expect(exec.argv).toContain('--append-system-prompt');
    expect(appendArg(exec.argv)).toContain('AGENTS.md');
  });

  it('rides ahead of the composed append payload', () => {
    delete process.env.TALE_SANDBOX_HOUSE_RULES;
    const append =
      appendArg(
        adapter.buildExec(baseSpec({ systemPromptAppend: 'COMPOSED-MARKER' }))
          .argv,
      ) ?? '';
    expect(append).toContain('COMPOSED-MARKER');
    // House rules come first; the composed payload (which ends with the
    // untrusted-content safety block) keeps its trailing position.
    expect(append.indexOf('AGENTS.md')).toBeLessThan(
      append.indexOf('COMPOSED-MARKER'),
    );
  });

  it('does not double-append when the rules are already present', () => {
    delete process.env.TALE_SANDBOX_HOUSE_RULES;
    const composed = appendArg(adapter.buildExec(baseSpec()).argv) ?? '';
    const append =
      appendArg(
        adapter.buildExec(baseSpec({ systemPromptAppend: composed })).argv,
      ) ?? '';
    expect(append.split('AGENTS.md').length - 1).toBe(1);
  });

  it('respects the TALE_SANDBOX_HOUSE_RULES=0 operator override', () => {
    process.env.TALE_SANDBOX_HOUSE_RULES = '0';
    // No composed append + rules disabled → no --append-system-prompt at all.
    expect(adapter.buildExec(baseSpec()).argv).not.toContain(
      '--append-system-prompt',
    );
  });

  it('applies to BYO sessions too', () => {
    delete process.env.TALE_SANDBOX_HOUSE_RULES;
    const exec = adapter.buildExec(baseSpec({ authMode: 'byo' }));
    expect(appendArg(exec.argv)).toContain('AGENTS.md');
  });
});

describe('ClaudeCodeAdapter buildExec — BYO native model', () => {
  const prev = process.env.TALE_SANDBOX_CONTEXT_1M;
  afterEach(() => {
    if (prev === undefined) delete process.env.TALE_SANDBOX_CONTEXT_1M;
    else process.env.TALE_SANDBOX_CONTEXT_1M = prev;
  });

  it('maps the shipped rolling-alias default to Anthropic-native Fable', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        model: 'openrouter:~anthropic/claude-fable-latest',
      }),
    );
    expect(modelArg(exec.argv)).toBe('claude-fable-5[1m]');
    expect(exec.env.ANTHROPIC_MODEL).toBe('claude-fable-5[1m]');
  });

  it('maps every shipped Fable default ref shape (with and without prefix)', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    for (const ref of [
      '~anthropic/claude-fable-latest',
      'openrouter:anthropic/claude-fable-5',
      'anthropic/claude-fable-5',
    ]) {
      const exec = adapter.buildExec(baseSpec({ authMode: 'byo', model: ref }));
      expect(modelArg(exec.argv)).toBe('claude-fable-5[1m]');
    }
  });

  it('passes an explicitly specified BYO model through unchanged (no override)', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(
      baseSpec({ authMode: 'byo', model: 'claude-opus-4-20250514' }),
    );
    // Not a shipped default ref → exactly as specified (plus the [1m] window
    // marker every session gets, which Claude Code strips before the API).
    expect(modelArg(exec.argv)).toBe('claude-opus-4-20250514[1m]');
  });

  it('leaves managed sessions on the gateway catalog ref', () => {
    delete process.env.TALE_SANDBOX_CONTEXT_1M;
    const exec = adapter.buildExec(
      baseSpec({ model: '~anthropic/claude-fable-latest' }),
    );
    expect(modelArg(exec.argv)).toBe('~anthropic/claude-fable-latest[1m]');
    expect(exec.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe(
      '~anthropic/claude-fable-latest',
    );
  });
});

describe('ClaudeCodeAdapter buildExec — managed fallback model', () => {
  function fallbackArg(argv: string[]): string | undefined {
    const i = argv.indexOf('--fallback-model');
    return i >= 0 ? argv[i + 1] : undefined;
  }

  it('arms the availability chain and points the non-Fable slots at the fallback', () => {
    const exec = adapter.buildExec(
      baseSpec({
        model: '~anthropic/claude-fable-latest',
        fallbackModel: 'anthropic/claude-opus-4.8',
      }),
    );
    expect(fallbackArg(exec.argv)).toBe('anthropic/claude-opus-4.8');
    // Content-based Fable fallback re-runs on the OPUS slot — it must be the
    // fallback, not the (rationed/flagged) primary.
    expect(exec.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      'anthropic/claude-opus-4.8',
    );
    expect(exec.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
      'anthropic/claude-opus-4.8',
    );
    expect(exec.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      'anthropic/claude-opus-4.8',
    );
    // The FABLE slot stays the primary — it is how Claude Code identifies the
    // gateway id as Fable 5, which arms the fallback at all.
    expect(exec.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe(
      '~anthropic/claude-fable-latest',
    );
    expect(exec.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe(
      '~anthropic/claude-fable-latest',
    );
  });

  it('keeps all slots on the primary when no fallback was resolved', () => {
    const exec = adapter.buildExec(
      baseSpec({ model: '~anthropic/claude-fable-latest' }),
    );
    expect(fallbackArg(exec.argv)).toBeUndefined();
    expect(exec.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      '~anthropic/claude-fable-latest',
    );
  });

  it('never applies to BYO (specified model, no override)', () => {
    const exec = adapter.buildExec(
      baseSpec({
        authMode: 'byo',
        model: 'claude-opus-4-20250514',
        fallbackModel: 'anthropic/claude-opus-4.8',
      }),
    );
    expect(fallbackArg(exec.argv)).toBeUndefined();
    expect(exec.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  });
});
