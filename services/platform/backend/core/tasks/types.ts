/**
 * The WORKER a task belongs to — exactly one of three classes: a human
 * (`user`), an AI agent (`agent`), or an automation (`app` — `assigneeId`
 * then holds the automation's store name, and the board's status verbs run
 * its workflow).
 */
export type TaskAssigneeType = 'user' | 'agent' | 'app';

/**
 * The `comment` object embedded in `comment.created` / `comment.mentioned`
 * automation events. Task comments live in the message store (no comment doc
 * to attach), so this object is RECONSTRUCTED at emit time. Its shape is
 * load-bearing for the task-ops pack: `react-to-mention-in-task` reads
 * `input.comment.body`, and `comment.*` event filters resolve
 * `comment.projectId` by dot-notation — keep both fields. Typing the
 * reconstruction fails the build if an emit site drifts from this shape.
 */
export interface CommentEventComment {
  body: string;
  projectId: string;
  taskId: string;
  mentions: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
}
