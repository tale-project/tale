import { describe, expect, it } from 'vitest';

import {
  buildSettleCommentBody,
  SETTLE_REPORT_TRUNCATED_TAIL,
} from './agent_run_host.ts';
import { TASK_COMMENT_MAX } from './helpers.ts';

/**
 * The settle comment must always fit the comment door's cap: a report
 * longer than `TASK_COMMENT_MAX` used to be refused (caught, logged) while
 * the task still parked at in_review with no report in its discussion.
 */
describe('buildSettleCommentBody', () => {
  const fileNames = ['report.md', 'chart.png'];
  const skippedNotes = ['huge.bin — over the size cap'];

  it('posts a short report whole, with the deliverables and skipped lists', () => {
    const body = buildSettleCommentBody({
      resultText: 'All done.',
      fileNames,
      skippedNotes,
    });
    expect(body).toBe(
      [
        'All done.',
        'Deliverables:\n- report.md\n- chart.png',
        'Not delivered (the harvest skipped these outputs):\n- huge.bin — over the size cap',
      ].join('\n\n'),
    );
  });

  it('cuts an over-long report to the cap and keeps the lists whole', () => {
    const body = buildSettleCommentBody({
      resultText: 'x'.repeat(TASK_COMMENT_MAX + 5_000),
      fileNames,
      skippedNotes,
    });
    expect(body.length).toBe(TASK_COMMENT_MAX);
    expect(body).toContain(SETTLE_REPORT_TRUNCATED_TAIL);
    expect(
      body.endsWith(
        'Deliverables:\n- report.md\n- chart.png\n\nNot delivered (the harvest skipped these outputs):\n- huge.bin — over the size cap',
      ),
    ).toBe(true);
    // The tail sits right after the cut report, before the lists.
    expect(body.indexOf(SETTLE_REPORT_TRUNCATED_TAIL)).toBeLessThan(
      body.indexOf('Deliverables:'),
    );
  });

  it('leaves a report that exactly fits untouched', () => {
    const resultText = 'y'.repeat(TASK_COMMENT_MAX);
    const body = buildSettleCommentBody({
      resultText,
      fileNames: [],
      skippedNotes: [],
    });
    expect(body).toBe(resultText);
  });

  it('cuts the whole body when the lists alone overflow the cap', () => {
    const body = buildSettleCommentBody({
      resultText: 'Done.',
      fileNames: Array.from({ length: 2_000 }, (_, i) => `file-${i}.txt`),
      skippedNotes: [],
    });
    expect(body.length).toBe(TASK_COMMENT_MAX);
    expect(body.endsWith(SETTLE_REPORT_TRUNCATED_TAIL)).toBe(true);
  });
});
