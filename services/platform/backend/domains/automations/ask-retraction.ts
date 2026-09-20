import type { TransactionSql } from 'postgres';

/** The actor the workflow's own task-timeline cards carry — the "Question
 * for you" card an `ask_human` posts names it (`workspace_tools_bridge`). */
export const WORKFLOW_COMMENT_ACTOR = 'workflow';

/**
 * Retract a question card on a task's timeline once its ask stops taking an
 * answer. The `ask_human` card ("🙋 Question for you — … Answer it from this
 * task's assistant panel") stayed the newest comment after the run was
 * cancelled or the question expired, inviting a person to answer a question
 * the door now refuses with `HUMAN_ASK_NOT_PENDING` (2026-09-19 evaluation,
 * K3-5). The retraction is posted as the same trusted workflow actor, in the
 * same automated voice, on the same task; a card whose task is gone is
 * silently nothing to retract.
 */
export async function retractAskOnTask(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    /** Why the question closed, as a clause: "the run was cancelled". */
    reason: string;
  },
): Promise<void> {
  try {
    // Loaded on first use: the comment writer reads the automation store
    // (the deployed version a comment's `@agent` mention starts), so a
    // static import here would close a cycle back into the store that
    // imports this module.
    const { addTaskComment } = await import('../tasks/comments.ts');
    await addTaskComment(
      tx,
      {
        organizationId: args.organizationId,
        userId: WORKFLOW_COMMENT_ACTOR,
        role: 'admin',
        teamIds: [],
      },
      {
        taskId: args.taskId,
        body: `[automated] 🙋 ${args.reason} — the question above no longer takes an answer.`,
        author: { actorType: 'agent', actorId: WORKFLOW_COMMENT_ACTOR },
      },
    );
  } catch (error) {
    // Best effort, like the card itself: the ask is closed either way, and
    // a task retired in the meantime has no timeline to retract on.
    console.warn('[asks] question retraction not posted', {
      taskId: args.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
