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
  /** The comment as stored: mentions are mention tokens,
   * `[@Ada Lovelace](mention:user/<id>)`. */
  body: string;
  /** The same text with every mention read as `@` and the name, for a
   * reader that matches words (`@Ada Lovelace please check`). */
  bodyText: string;
  projectId: string;
  taskId: string;
  mentions: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
}
