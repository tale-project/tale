// Pure pieces of the mid-run comment steering lane — which delivery lane a
// harness gets (its YAML `capabilities.steering` fact), and the exact texts
// a live turn (stdin) or a restarted turn (--resume / fresh) receives. The
// convex-test halves (the mention door, the exec rotation, the exec-guarded
// marks, the steer-miss fallback) live in task_agent_runs.test.ts.

import { describe, expect, it } from 'vitest';

import {
  buildResumeSteerPrompt,
  buildSteerCommentText,
  FRESH_RESTART_NOTE,
  steerLaneForHarness,
} from './agent_run_host';

describe('steerLaneForHarness', () => {
  it('stdin for the steering-capable harness', () => {
    expect(steerLaneForHarness('claude-code')).toBe('stdin');
  });

  it('restart for harnesses that take no input once launched', () => {
    expect(steerLaneForHarness('codex')).toBe('restart');
    expect(steerLaneForHarness('cursor')).toBe('restart');
    expect(steerLaneForHarness('gemini')).toBe('restart');
  });

  it('restart for an unknown slug — never a blind stdin write', () => {
    expect(steerLaneForHarness('not-a-harness')).toBe('restart');
  });
});

describe('steer texts', () => {
  it('the stdin line names the author, carries the body, and asks for course correction', () => {
    const text = buildSteerCommentText(
      'Larry Luo',
      '空白页太多了，去掉纯背景图片页',
    );
    expect(text).toContain('Task comment from Larry Luo');
    expect(text).toContain('空白页太多了，去掉纯背景图片页');
    expect(text).toContain('adjust course now');
  });

  it('the resume prompt continues the conversation and forbids redoing work', () => {
    const text = buildResumeSteerPrompt(
      'Larry Luo',
      'use real photos on page 3',
    );
    expect(text).toContain('SAME task and the SAME conversation');
    expect(text).toContain('use real photos on page 3');
    expect(text).toContain('do NOT redo completed work');
  });

  it('the fresh-restart note points at the surviving workspace', () => {
    expect(FRESH_RESTART_NOTE).toContain('could not be resumed');
    expect(FRESH_RESTART_NOTE).toContain('workspace');
  });
});
