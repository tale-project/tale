// `buildTaskPrompt` — the task-agent turn's brief. Feedback (the @mention
// comment that kicked a rerun) must lead the work section as the delta to
// address, and its absence must leave the brief byte-identical to before.
// The discussion tail and the staged-inputs block are a rerun's ONLY memory
// of earlier runs (each turn is a fresh conversation), so their rendering —
// and their absence leaving the brief untouched — is pinned here too.

import { describe, expect, it } from 'vitest';

import {
  buildTaskPrompt,
  safeInputFileName,
  taskInputsDir,
  taskOutputDir,
} from './agent_run_host';

const BRIEF = {
  title: 'Build the deck',
  description: 'A 15-slide panda deck.',
  identifier: 'TAL-7',
  projectName: 'Apollo',
};

const DISCUSSION = [
  { author: 'user' as const, body: '请做一份熊猫介绍' },
  {
    author: 'agent' as const,
    body: 'Done — 20 slides delivered as deck.pptx.',
  },
  { author: 'user' as const, body: '趣闻栏目再加两页 @alice' },
];

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

describe('discussion tail', () => {
  it('renders oldest-first between the description and the feedback, deduping the kicking comment', () => {
    const prompt = buildTaskPrompt(
      { ...BRIEF, discussion: DISCUSSION },
      '趣闻栏目再加两页 @alice',
    );
    expect(prompt).toContain('Task discussion so far');
    expect(prompt).toContain('User: 请做一份熊猫介绍');
    expect(prompt).toContain(
      'You (an earlier run): Done — 20 slides delivered as deck.pptx.',
    );
    // The kicking comment appears exactly once — as feedback, not history.
    expect(prompt.match(/趣闻栏目再加两页/g)).toHaveLength(1);
    expect(prompt.indexOf('Task discussion')).toBeGreaterThan(
      prompt.indexOf('Description:'),
    );
    expect(prompt.indexOf('Task discussion')).toBeLessThan(
      prompt.indexOf('reviewer feedback'),
    );
  });

  it('keeps a trailing user comment that is NOT the feedback', () => {
    const prompt = buildTaskPrompt(
      { ...BRIEF, discussion: DISCUSSION },
      'a different instruction',
    );
    expect(prompt).toContain('User: 趣闻栏目再加两页 @alice');
  });

  it('an empty tail leaves the brief byte-identical', () => {
    expect(buildTaskPrompt({ ...BRIEF, discussion: [] })).toBe(
      buildTaskPrompt(BRIEF),
    );
  });
});

describe('staged task inputs', () => {
  const INPUTS = {
    dir: taskInputsDir('wh76abc'),
    attachments: ['spec.pdf'],
    outputs: ['deck.pptx'],
  };

  it('names the staged copies and the same-file-name replace rule', () => {
    const prompt = buildTaskPrompt(
      BRIEF,
      undefined,
      '/user/output/wh76abc',
      INPUTS,
    );
    expect(prompt).toContain(
      '- /user/inputs/wh76abc/attachments/ — files the user attached to the task: spec.pdf',
    );
    expect(prompt).toContain(
      "- /user/inputs/wh76abc/outputs/ — the task's current deliverables, produced by earlier runs: deck.pptx",
    );
    expect(prompt).toContain('under the SAME file name');
    expect(prompt.indexOf('Task inputs')).toBeLessThan(
      prompt.indexOf('Deliverables:'),
    );
  });

  it('omits the replace rule when no prior deliverables were staged', () => {
    const prompt = buildTaskPrompt(BRIEF, undefined, undefined, {
      ...INPUTS,
      outputs: [],
    });
    expect(prompt).toContain('spec.pdf');
    expect(prompt).not.toContain('SAME file name');
  });

  it('nothing staged leaves the brief byte-identical', () => {
    expect(
      buildTaskPrompt(BRIEF, undefined, undefined, {
        ...INPUTS,
        attachments: [],
        outputs: [],
      }),
    ).toBe(buildTaskPrompt(BRIEF));
  });
});

describe('safeInputFileName', () => {
  it('flattens separators, refuses dot-names, and dedupes collisions', () => {
    const taken = new Set<string>();
    expect(safeInputFileName('../../etc/passwd', taken)).toBe(
      '.._.._etc_passwd',
    );
    expect(safeInputFileName('spec.pdf', taken)).toBe('spec.pdf');
    expect(safeInputFileName('spec.pdf', taken)).toBe('2-spec.pdf');
    expect(safeInputFileName('spec.pdf', taken)).toBe('3-spec.pdf');
    expect(safeInputFileName('  ', taken)).toBe('file');
    expect(safeInputFileName('..', taken)).toBe('2-file');
  });
});
