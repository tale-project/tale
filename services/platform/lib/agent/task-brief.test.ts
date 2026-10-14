import { describe, expect, it } from 'vitest';

import {
  composeTaskBrief,
  discussionBeforeFeedback,
  handoffSection,
  NATIVE_DELIVERY,
  nativeInputsBlock,
  requesterFeedbackSection,
  requesterStartLine,
  TASK_REPORT_INSTRUCTION,
  type TaskBriefFacts,
} from './task-brief';

const BRIEF: TaskBriefFacts = {
  title: 'Quarterly report',
  description: 'Summarize Q3.',
  labels: ['finance'],
  identifier: 'WR-12',
  projectName: 'Website relaunch',
  discussion: [
    { author: 'user', body: 'Use CHF.' },
    { author: 'agent', body: 'Drafted it.' },
  ],
};

describe('composeTaskBrief', () => {
  it('states the task, then what the engine adds, and always closes on the report', () => {
    const text = composeTaskBrief({
      brief: BRIEF,
      inputsBlock: 'INPUTS',
      delivery: 'DELIVERY',
    });
    const order = [
      'You are working on task WR-12: Quarterly report',
      'Project: Website relaunch',
      'Labels: finance',
      'Description:\nSummarize Q3.',
      'Task discussion so far',
      'INPUTS',
      'DELIVERY',
      TASK_REPORT_INSTRUCTION,
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names a task without a key by its title alone', () => {
    const { identifier: _identifier, ...keyless } = BRIEF;
    expect(composeTaskBrief({ brief: keyless })).toMatch(
      /^You are working on this task: Quarterly report/,
    );
  });

  it('leads the work with the feedback and says it once', () => {
    const text = composeTaskBrief({
      brief: {
        ...BRIEF,
        discussion: [
          ...(BRIEF.discussion ?? []),
          { author: 'user', body: 'Add a chart.' },
        ],
      },
      feedback: 'Add a chart.',
    });
    expect(text.split('Add a chart.')).toHaveLength(2);
    expect(text).toMatch(/sent back with reviewer feedback/);
  });

  it('says who started a run no person started, and ranks a person above them', () => {
    const text = composeTaskBrief({
      brief: BRIEF,
      feedback: 'Re-check the totals.',
      requester: { kind: 'automation', name: 'Weekly digest' },
    });
    expect(text).toContain('the automation "Weekly digest"');
    expect(text).toMatch(/those win/);
    expect(
      composeTaskBrief({
        brief: BRIEF,
        requester: { kind: 'agent', name: 'Planner' },
      }),
    ).toContain(
      'Planner, another agent of this project, rather than by a person.',
    );
  });

  it('carries a lighter pass’s handover after the feedback and before the inputs', () => {
    const text = composeTaskBrief({
      brief: BRIEF,
      feedback: 'Use CHF.',
      handoff: {
        reason: 'Needs the repository.',
        brief: 'Fix the failing test.',
      },
      inputsBlock: 'INPUTS',
    });
    expect(text.indexOf('reviewer feedback')).toBeLessThan(
      text.indexOf('handed the task over to you'),
    );
    expect(text.indexOf('Fix the failing test.')).toBeLessThan(
      text.indexOf('INPUTS'),
    );
    expect(text).toMatch(/do not redo what is done/);
  });
});

describe('the shared helpers', () => {
  it('drops the closing discussion entry only when it is the feedback', () => {
    const discussion = [
      { author: 'agent' as const, body: 'Done.' },
      { author: 'user' as const, body: 'Please redo it.' },
    ];
    expect(
      discussionBeforeFeedback(discussion, 'Please redo it.'),
    ).toHaveLength(1);
    expect(discussionBeforeFeedback(discussion, 'Other')).toHaveLength(2);
    expect(discussionBeforeFeedback(discussion, '')).toHaveLength(2);
  });

  it('words a requester the same wherever it is said', () => {
    const automation = { kind: 'automation' as const, name: 'Digest' };
    expect(requesterStartLine(automation)).toBe(
      'This run was started by the automation "Digest" rather than by a person.',
    );
    expect(requesterFeedbackSection(automation, 'Go.')).toMatch(
      /It comes from an automation, not from a person/,
    );
    expect(handoffSection({ reason: ' why ', brief: ' what ' })).toMatch(
      /why\n\nIts brief for you:\n\nwhat/,
    );
  });

  it("names the project's dispatch, and the standing role it started a run for [TASK-R47]", () => {
    expect(requesterStartLine({ kind: 'dispatch', name: '' })).toBe(
      "This run was started by the project's dispatch, which starts ready work on idle agents, rather than by a person.",
    );
    const role = { kind: 'dispatch' as const, name: 'manager-light' };
    expect(requesterStartLine(role)).toBe(
      'This run was started by the project\'s dispatch, for the standing role "manager-light", rather than by a person.',
    );
    expect(requesterFeedbackSection(role, 'Go.')).toMatch(
      /It comes from the project's dispatch, not from a person/,
    );
  });
});

describe('nativeInputsBlock', () => {
  const file = (name: string) => ({ ref: `s3:${name}`, name });

  it('says nothing for a task with no files', () => {
    expect(nativeInputsBlock({ attachments: [], outputs: [] })).toBeUndefined();
  });

  it('names each file with the ref a tool reads it by, attachments before deliverables', () => {
    const text = nativeInputsBlock({
      attachments: [file('brief.pdf')],
      outputs: [file('deck.pptx')],
    });
    expect(text).toContain('- brief.pdf (ref: s3:brief.pdf)');
    expect(text).toContain('- deck.pptx (ref: s3:deck.pptx)');
    expect(text?.indexOf('brief.pdf')).toBeLessThan(
      text?.indexOf('deck.pptx') ?? -1,
    );
    expect(text).toMatch(/SAME file name/);
  });

  it('keeps the revision rule out when there is no deliverable to revise', () => {
    expect(
      nativeInputsBlock({ attachments: [file('brief.pdf')], outputs: [] }),
    ).not.toMatch(/SAME file name/);
  });

  it('says how many older deliverables it left out', () => {
    expect(
      nativeInputsBlock({
        attachments: [],
        outputs: [file('deck.pptx')],
        omittedOutputs: 3,
      }),
    ).toContain('3 older deliverables stay on the task');
  });
});

describe('a native brief', () => {
  it('names its files and its delivery between the facts and the report', () => {
    const text = composeTaskBrief({
      brief: BRIEF,
      inputsBlock: nativeInputsBlock({
        attachments: [{ ref: 's3:a', name: 'a.pdf' }],
        outputs: [],
      }),
      delivery: NATIVE_DELIVERY,
    });
    expect(text.indexOf('(ref: s3:a)')).toBeLessThan(
      text.indexOf(NATIVE_DELIVERY),
    );
    expect(text.indexOf(NATIVE_DELIVERY)).toBeLessThan(
      text.indexOf(TASK_REPORT_INSTRUCTION),
    );
  });
});
