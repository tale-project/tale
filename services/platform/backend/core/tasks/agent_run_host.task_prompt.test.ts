import { describe, expect, it } from 'vitest';

import { buildTaskPrompt } from './agent_run_host.ts';

/**
 * A mention kick carries the text that named the agent as its feedback. A
 * comment's leads the work section; a description's IS the brief's
 * Description, so a fresh conversation reads it once (a resumed one does not
 * re-read the brief, and gets it as the feedback).
 */
describe('buildTaskPrompt — the kick feedback', () => {
  const FEEDBACK_HEAD = 'The task was sent back with reviewer feedback';

  it("says a description mention's text once, as the Description", () => {
    const description = '@writer draft a one-page overview of the launch';
    const prompt = buildTaskPrompt(
      { title: 'Launch overview', description, discussion: [] },
      description,
    );
    expect(prompt).toContain(`Description:\n${description}`);
    expect(prompt).not.toContain(FEEDBACK_HEAD);
    expect(prompt.split(description)).toHaveLength(2);
  });

  it("still leads with a comment's feedback, said once", () => {
    const comment = '@writer please shorten the second section';
    const prompt = buildTaskPrompt(
      {
        title: 'Launch overview',
        description: 'Draft a one-page overview of the launch',
        discussion: [{ author: 'user', body: comment }],
      },
      comment,
    );
    expect(prompt).toContain(
      `${FEEDBACK_HEAD} — address it before anything else:\n${comment}`,
    );
    expect(prompt.split(comment)).toHaveLength(2);
  });
});
