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
