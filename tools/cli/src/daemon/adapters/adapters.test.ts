import { describe, expect, it } from 'bun:test';

import { effectivePermission } from '../config';
import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { opencodeAdapter } from './opencode';
import { parseJsonObjects } from './types';

describe('permission ceiling', () => {
  it('effective permission is min(server request, daemon ceiling)', () => {
    expect(effectivePermission('full_auto', 'safe')).toBe('safe');
    expect(effectivePermission('safe', 'full_auto')).toBe('safe');
    expect(effectivePermission('auto_edits', 'full_auto')).toBe('auto_edits');
    expect(effectivePermission('full_auto', 'full_auto')).toBe('full_auto');
  });
});

describe('claude_code adapter', () => {
  it('builds headless args with permission + resume mapping', () => {
    const fresh = claudeCodeAdapter.buildInvocation({
      prompt: 'do it',
      permissionMode: 'auto_edits',
    });
    expect(fresh.command).toBe('claude');
    expect(fresh.args).toEqual([
      '-p',
      'do it',
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
    ]);

    const resumed = claudeCodeAdapter.buildInvocation({
      prompt: 'fix it',
      permissionMode: 'full_auto',
      resumeSessionRef: 'sess-1',
    });
    expect(resumed.args).toContain('--resume');
    expect(resumed.args).toContain('sess-1');
    expect(resumed.args).toContain('--dangerously-skip-permissions');
  });

  it('parses the JSON result incl. dollar cost → cents', () => {
    const outcome = claudeCodeAdapter.parseOutput(
      JSON.stringify({
        result: 'Implemented the fix.',
        session_id: 'sess-9',
        total_cost_usd: 0.42,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );
    expect(outcome.summary).toBe('Implemented the fix.');
    expect(outcome.sessionRef).toBe('sess-9');
    expect(outcome.costCents).toBe(42);
    expect(outcome.inputTokens).toBe(100);
    expect(outcome.outputTokens).toBe(50);
  });

  it('falls back to raw stdout when nothing parses', () => {
    const outcome = claudeCodeAdapter.parseOutput('plain text output');
    expect(outcome.summary).toBe('plain text output');
    expect(outcome.costCents).toBeUndefined();
  });
});

describe('codex adapter', () => {
  it('maps the permission ceiling onto --sandbox and supports resume', () => {
    const fresh = codexAdapter.buildInvocation({
      prompt: 'p',
      permissionMode: 'safe',
    });
    expect(fresh.args).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      'p',
    ]);

    const resumed = codexAdapter.buildInvocation({
      prompt: 'p2',
      permissionMode: 'auto_edits',
      resumeSessionRef: 'thread-7',
    });
    expect(resumed.args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-7']);
    expect(resumed.args).toContain('workspace-write');
  });

  it('parses JSONL events: last message + usage + session', () => {
    const stdout = [
      JSON.stringify({ msg: { type: 'session.created' }, session_id: 's1' }),
      JSON.stringify({ msg: { text: 'working…' } }),
      JSON.stringify({
        msg: {
          last_agent_message: 'All done.',
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      }),
    ].join('\n');
    const outcome = codexAdapter.parseOutput(stdout);
    expect(outcome.summary).toBe('All done.');
    expect(outcome.sessionRef).toBe('s1');
    expect(outcome.inputTokens).toBe(10);
    expect(outcome.outputTokens).toBe(4);
  });
});

describe('opencode adapter', () => {
  it('builds run args with session resume', () => {
    const invocation = opencodeAdapter.buildInvocation({
      prompt: 'p',
      permissionMode: 'safe',
      resumeSessionRef: 'oc-2',
    });
    expect(invocation.args).toEqual([
      'run',
      'p',
      '--format',
      'json',
      '-s',
      'oc-2',
    ]);
  });
});

describe('parseJsonObjects', () => {
  it('tolerates mixed prose + JSONL and whole-document JSON', () => {
    expect(parseJsonObjects('hello\n{"a":1}\nnoise\n{"b":2}')).toHaveLength(2);
    expect(parseJsonObjects('{"only":true}')).toHaveLength(1);
    expect(parseJsonObjects('no json at all')).toHaveLength(0);
  });
});
