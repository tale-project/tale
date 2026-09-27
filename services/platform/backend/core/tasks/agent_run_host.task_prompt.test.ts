import { describe, expect, it } from 'vitest';

import {
  buildKickPrompts,
  buildResumeSteerPrompt,
  buildSteerCommentText,
  buildTaskPrompt,
} from './agent_run_host.ts';

/**
 * What a mention kick hands the agent. A comment's text is the run's stored
 * feedback and leads the work section. A description mention stores no copy:
 * the turn reads the description as it stands when it starts, which can be
 * minutes after the kick (a queued run, a capacity park). An edit in that
 * window names nobody new and fires nothing, so a copy taken at kick time
 * would sit beside the edited description as an instruction that outranks
 * it.
 */
const FEEDBACK_HEAD = 'The task was sent back with reviewer feedback';
const EDIT_HEAD = 'The task description was edited to mention you';

const KICKED_WITH = '@writer draft the brief in German';
const EDITED_TO = '@writer draft the brief in French';

const inputs = { dir: '/agent/inputs/task-1', attachments: [], outputs: [] };

function brief(description: string) {
  return {
    title: 'Launch brief',
    description,
    discussion: [
      { author: 'user' as const, body: 'Earlier note', at: 100 },
      { author: 'agent' as const, body: 'Drafted v1', at: 200 },
    ],
  };
}

describe('buildTaskPrompt — the kick feedback', () => {
  it("leads with a comment's feedback, said once", () => {
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

describe('buildKickPrompts — a description mention', () => {
  it('opens a fresh conversation on the description as it reads at the start', () => {
    const { fresh } = buildKickPrompts({
      // Even if a kick-time copy reached the host, the description wins.
      brief: brief(EDITED_TO),
      feedback: KICKED_WITH,
      mentionSource: 'description',
      outputDir: '/agent/output/task-1',
      inputs,
    });
    expect(fresh).toContain(`Description:\n${EDITED_TO}`);
    expect(fresh).not.toContain(KICKED_WITH);
    expect(fresh).not.toContain(FEEDBACK_HEAD);
    expect(fresh.split(EDITED_TO)).toHaveLength(2);
  });

  it('hands a resumed conversation the current description, as an edit', () => {
    const { resume } = buildKickPrompts({
      brief: brief(EDITED_TO),
      mentionSource: 'description',
      outputDir: '/agent/output/task-1',
      inputs,
      resumeDiscussionSince: 150,
    });
    expect(resume).toContain(`${EDIT_HEAD}. It now reads:\n${EDITED_TO}`);
    expect(resume).not.toContain(KICKED_WITH);
    // Not a review that sent finished work back.
    expect(resume).not.toContain(FEEDBACK_HEAD);
    // The discussion delta still rides: only what came after the
    // predecessor started.
    expect(resume).toContain('Agent: Drafted v1');
    expect(resume).not.toContain('Earlier note');
  });

  it("keeps a comment mention's stored text as its feedback", () => {
    const comment = '@writer please shorten the second section';
    const { fresh, resume } = buildKickPrompts({
      brief: brief(EDITED_TO),
      feedback: comment,
      mentionSource: 'comment',
      outputDir: '/agent/output/task-1',
      inputs,
    });
    expect(fresh).toContain(
      `${FEEDBACK_HEAD} — address it before anything else:\n${comment}`,
    );
    expect(resume).toContain(
      `${FEEDBACK_HEAD} — address it before anything else:\n${comment}`,
    );
    expect(resume).not.toContain(EDIT_HEAD);
  });
});

describe('the steer text — a comment or a description edit', () => {
  it('names a description edit as an edit, in the live turn and on a resumed restart', () => {
    const live = buildSteerCommentText('Olive', EDITED_TO, 'description');
    expect(live).toContain(
      'Olive edited the task description to mention you while you are working',
    );
    expect(live).not.toContain('Task comment from');
    const restarted = buildResumeSteerPrompt('Olive', EDITED_TO, 'description');
    expect(restarted).toContain(
      'the task description was edited to mention you',
    );
    expect(restarted).toContain(`It now reads:\n\n${EDITED_TO}`);
    expect(restarted).not.toContain('Task comment from');
  });

  it('still says a comment is a comment — and a steer queued without a source is one', () => {
    expect(buildSteerCommentText('Olive', 'shorter please')).toContain(
      'Task comment from Olive, posted while you are working',
    );
    expect(
      buildResumeSteerPrompt('Olive', 'shorter please', 'comment'),
    ).toContain('Task comment from Olive:');
  });
});
