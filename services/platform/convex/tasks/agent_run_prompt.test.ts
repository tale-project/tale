// `buildTaskPrompt` — the task-agent turn's brief. Feedback (the @mention
// comment that kicked a rerun) must lead the work section as the delta to
// address, and its absence must leave the brief byte-identical to before.

import { describe, expect, it } from 'vitest';

import { buildTaskPrompt, taskOutputDir } from './agent_run_host';

const BRIEF = {
  title: 'Build the deck',
  description: 'A 15-slide panda deck.',
  identifier: 'TAL-7',
  projectName: 'Apollo',
};

describe('buildTaskPrompt', () => {
  it('folds reviewer feedback in ahead of the report instruction', () => {
    const prompt = buildTaskPrompt(BRIEF, '第3页的图请换成真实照片');
    expect(prompt).toContain(
      'The task was sent back with reviewer feedback — address it before anything else:\n第3页的图请换成真实照片',
    );
    expect(prompt.indexOf('reviewer feedback')).toBeGreaterThan(
      prompt.indexOf('Description:'),
    );
    expect(prompt.indexOf('reviewer feedback')).toBeLessThan(
      prompt.indexOf('When you are done'),
    );
  });

  it('leaves the brief untouched without feedback', () => {
    expect(buildTaskPrompt(BRIEF)).toBe(buildTaskPrompt(BRIEF, '   '));
    expect(buildTaskPrompt(BRIEF)).not.toContain('reviewer feedback');
  });
});

describe('taskOutputDir', () => {
  it('scopes the delivery box per task under the session box', () => {
    expect(taskOutputDir('wh76abc')).toBe('/user/output/wh76abc');
  });

  it('is named in the USER prompt so a resumed session cannot fall back to a remembered path', () => {
    const prompt = buildTaskPrompt(BRIEF, undefined, '/user/output/wh76abc');
    expect(prompt).toContain(
      'write every file you produce into /user/output/wh76abc/',
    );
    expect(prompt.indexOf('Deliverables:')).toBeLessThan(
      prompt.indexOf('When you are done'),
    );
  });
});
