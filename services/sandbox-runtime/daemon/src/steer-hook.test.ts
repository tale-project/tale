import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve(import.meta.dir, '../../tale-steer-hook');

let steerDir: string;

beforeEach(() => {
  steerDir = realpathSync(mkdtempSync(`${tmpdir()}/steer-hook-`));
});
afterEach(() => {
  rmSync(steerDir, { recursive: true, force: true });
});

const stageMessage = (id: string, text: string) => {
  writeFileSync(
    join(steerDir, `steer-001-${id}.json`),
    JSON.stringify({ messageId: id, text, createdAt: 1 }),
  );
};

const runHook = (event: 'post' | 'stop', stdin: string, dir = steerDir) => {
  const res = spawnSync('bash', [HOOK, event], {
    input: stdin,
    env: { ...process.env, TALE_STEER_DIR: dir },
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout };
};

// Hook stdin payloads as Claude Code 2.1.173 emits them: main-loop tool calls
// carry no agent_id; subagent tool calls (Agent tool sidechains and Workflow
// subagents) carry a non-empty agent_id + agent_type.
const MAIN_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  session_id: 's-1',
  transcript_path:
    '/agent/.runtime/home/.claude/projects/-user-workspace/s-1.jsonl',
});
const SUBAGENT_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  session_id: 's-1',
  transcript_path:
    '/agent/.runtime/home/.claude/projects/-user-workspace/s-1.jsonl',
  agent_id: 'a70ae7242b88701bc',
  agent_type: 'general-purpose',
});
const WORKFLOW_SUBAGENT_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  session_id: 's-1',
  agent_id: 'a622fa9e2d1ed1b9d',
  agent_type: 'workflow-subagent',
});

describe('tale-steer-hook', () => {
  test('main-loop post boundary consumes pending messages', () => {
    stageMessage('m1', 'change of plans');
    const { status, stdout } = runHook('post', MAIN_PAYLOAD);
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput.additionalContext).toContain(
      '[TALE_STEER ids=m1]',
    );
    expect(out.hookSpecificOutput.additionalContext).toContain(
      'change of plans',
    );
    expect(readdirSync(steerDir)).toEqual(['consumed.steer-001-m1.json']);
  });

  test('explicit agent_id: null counts as main loop', () => {
    stageMessage('m1', 'hello');
    const payload = JSON.stringify({ tool_name: 'Bash', agent_id: null });
    const { stdout } = runHook('post', payload);
    expect(stdout).toContain('[TALE_STEER ids=m1]');
    expect(readdirSync(steerDir)).toEqual(['consumed.steer-001-m1.json']);
  });

  test('stop boundary emits a block decision', () => {
    stageMessage('m1', 'one more thing');
    const stopPayload = JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 's-1',
      stop_hook_active: false,
    });
    const { stdout } = runHook('stop', stopPayload);
    const out = JSON.parse(stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('[TALE_STEER ids=m1]');
  });

  test('subagent tool call must not consume (Agent tool sidechain)', () => {
    stageMessage('m1', 'for the main loop only');
    const { status, stdout } = runHook('post', SUBAGENT_PAYLOAD);
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(readdirSync(steerDir)).toEqual(['steer-001-m1.json']);
  });

  test('subagent tool call must not consume (Workflow subagent)', () => {
    stageMessage('m1', 'for the main loop only');
    const { stdout } = runHook('post', WORKFLOW_SUBAGENT_PAYLOAD);
    expect(stdout).toBe('');
    expect(readdirSync(steerDir)).toEqual(['steer-001-m1.json']);
  });

  test('unparseable stdin skips instead of consuming', () => {
    stageMessage('m1', 'must survive');
    const { status, stdout } = runHook('post', 'not json at all');
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(readdirSync(steerDir)).toEqual(['steer-001-m1.json']);
  });

  test('empty steer dir exits clean with no output', () => {
    const { status, stdout } = runHook('post', MAIN_PAYLOAD);
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  test('missing TALE_STEER_DIR exits clean', () => {
    const res = spawnSync('bash', [HOOK, 'post'], {
      input: MAIN_PAYLOAD,
      env: { ...process.env, TALE_STEER_DIR: '' },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });

  test('partially written steer file is restored, valid one consumed', () => {
    stageMessage('m1', 'good');
    writeFileSync(join(steerDir, 'steer-002-m2.json'), '{"truncated');
    const { stdout } = runHook('post', MAIN_PAYLOAD);
    expect(stdout).toContain('[TALE_STEER ids=m1]');
    expect(readdirSync(steerDir).sort()).toEqual([
      'consumed.steer-001-m1.json',
      'steer-002-m2.json',
    ]);
  });

  test('empty-text tombstone is consumed silently (marker, no injection)', () => {
    // The platform blanks a file it re-delivered over the held-open stdin
    // (lingering delivery) — the hook must mark it consumed WITHOUT injecting
    // a second copy or emitting an empty payload.
    stageMessage('m1', '');
    const { status, stdout } = runHook('post', MAIN_PAYLOAD);
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(readdirSync(steerDir)).toEqual(['consumed.steer-001-m1.json']);
  });

  test('tombstone alongside a real message: only the real one injects', () => {
    stageMessage('m1', '');
    stageMessage('m2', 'real message');
    const { stdout } = runHook('post', MAIN_PAYLOAD);
    expect(stdout).toContain('[TALE_STEER ids=m2]');
    expect(stdout).not.toContain('m1,');
    expect(readdirSync(steerDir).sort()).toEqual([
      'consumed.steer-001-m1.json',
      'consumed.steer-001-m2.json',
    ]);
  });
});
