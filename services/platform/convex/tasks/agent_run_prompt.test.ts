// The task-agent turn's opening prompts. `buildTaskPrompt` is the FRESH
// conversation's brief: feedback (the @mention comment that kicked a rerun)
// must lead the work section as the delta to address, and its absence must
// leave the brief byte-identical to before; the discussion tail and the
// staged-inputs block are a fresh conversation's only memory of earlier
// runs, so their rendering — and their absence leaving the brief untouched —
// is pinned here too. `buildResumeKickPrompt` is the RESUMED lane: a later
// kick continuing the predecessor's harness conversation, carrying only the
// between-runs discussion delta. The launch-failure window shape and the
// harness-final-text failure reason are pinned beside them.

import { describe, expect, it } from 'vitest';

import {
  buildResumeKickPrompt,
  buildTaskPrompt,
  failureReasonFromFinalText,
  FRESH_KICK_RESTART_NOTE,
  isResumeLaunchFailure,
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

describe('buildResumeKickPrompt', () => {
  const OUTPUT_DIR = '/user/output/wh76abc';

  it('continues the conversation without redo, and names the delivery box', () => {
    const prompt = buildResumeKickPrompt({ outputDir: OUTPUT_DIR });
    expect(prompt).toContain('SAME task in the SAME conversation');
    expect(prompt).toContain('Do NOT redo work');
    // Status-agnostic: usable after a clean settle AND after a failure.
    expect(prompt).not.toContain('stopped');
    expect(prompt).not.toContain('restarted');
    expect(prompt).toContain(
      `write every file you produce into ${OUTPUT_DIR}/`,
    );
    expect(prompt).toContain('When you are done');
  });

  it('feedback leads the work and wins over stale conversation memory', () => {
    const prompt = buildResumeKickPrompt({
      outputDir: OUTPUT_DIR,
      feedback: '第3页的图请换成真实照片',
    });
    expect(prompt).toContain(
      'address it before anything else:\n第3页的图请换成真实照片',
    );
    expect(prompt).toContain('the feedback wins');
    expect(prompt.indexOf('reviewer feedback')).toBeLessThan(
      prompt.indexOf('Deliverables:'),
    );
  });

  it('carries the between-runs discussion delta, deduping the kicking comment', () => {
    const prompt = buildResumeKickPrompt({
      outputDir: OUTPUT_DIR,
      feedback: '趣闻栏目再加两页',
      discussion: [
        { author: 'agent', body: 'Done — 20 slides delivered.' },
        { author: 'user', body: '趣闻栏目再加两页' },
      ],
    });
    expect(prompt).toContain('Task discussion since your last turn');
    expect(prompt).toContain('Agent: Done — 20 slides delivered.');
    // The kicking comment appears exactly once — as feedback, not history.
    expect(prompt.match(/趣闻栏目再加两页/g)).toHaveLength(1);
  });

  it('no feedback and no delta stays minimal', () => {
    const prompt = buildResumeKickPrompt({ outputDir: OUTPUT_DIR });
    expect(prompt).not.toContain('Task discussion');
    expect(prompt).not.toContain('reviewer feedback');
  });
});

describe('isResumeLaunchFailure', () => {
  const DEAD_RESUME = {
    kind: 'terminal' as const,
    text: '',
    timeline: [],
    // The CLI echoes the missing conversation id straight back on its error
    // result — exactly the value that must never be stamped or retried.
    ended: {
      type: 'turn-ended' as const,
      status: 'error' as const,
      isError: true,
      sessionId: 'c2a38047-3e04-4874-b87a-6a38f56d5041',
    },
    exited: true,
    agentSessionId: 'c2a38047-3e04-4874-b87a-6a38f56d5041',
  };

  it('an errored terminal window with no content is a launch failure', () => {
    expect(isResumeLaunchFailure(DEAD_RESUME)).toBe(true);
  });

  it('a crash without turn-ended but with no content counts too', () => {
    expect(
      isResumeLaunchFailure({
        kind: 'terminal',
        text: '',
        timeline: [],
        exited: true,
      }),
    ).toBe(true);
  });

  it('a resumed turn that worked and THEN failed settles normally', () => {
    expect(
      isResumeLaunchFailure({
        ...DEAD_RESUME,
        text: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
        timeline: [{ type: 'text', text: '…' }],
      }),
    ).toBe(false);
  });

  it('a clean turn is never a launch failure', () => {
    expect(
      isResumeLaunchFailure({
        kind: 'terminal',
        text: 'done',
        timeline: [],
        ended: {
          type: 'turn-ended',
          status: 'completed',
          isError: false,
        },
        exited: true,
      }),
    ).toBe(false);
  });
});

describe('failureReasonFromFinalText', () => {
  it("surfaces the harness's own error text as the run failure reason", () => {
    expect(
      failureReasonFromFinalText(
        'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
      ),
    ).toBe(
      'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
    );
  });

  it('keeps the TAIL of a long transcript — the terminal error lives there', () => {
    const reason = failureReasonFromFinalText(
      `${'work narration '.repeat(100)}API Error: 429 rate limited`,
    );
    expect(reason).toMatch(/^… /);
    expect(reason).toContain('API Error: 429 rate limited');
    expect((reason ?? '').length).toBeLessThanOrEqual(502);
  });

  it('yields nothing for an empty transcript (the generic line stays)', () => {
    expect(failureReasonFromFinalText('   ')).toBeUndefined();
  });
});

describe('FRESH_KICK_RESTART_NOTE', () => {
  it('tells the fresh conversation to inspect the preserved work', () => {
    expect(FRESH_KICK_RESTART_NOTE).toContain('could not be continued');
    expect(FRESH_KICK_RESTART_NOTE).toContain('delivery box');
    expect(FRESH_KICK_RESTART_NOTE).toContain('inspect');
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
