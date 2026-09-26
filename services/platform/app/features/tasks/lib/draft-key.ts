/** The unsent comment of one task — kept like a chat's draft, per user and
 * organization, so leaving the task (or the board dialog) never loses it. */
export function taskCommentDraftKey(
  userId: string | undefined,
  organizationId: string,
  taskId: string,
) {
  const prefix =
    userId !== undefined
      ? `task-comment-draft-${userId}-${organizationId}`
      : `task-comment-draft-${organizationId}`;
  return `${prefix}-${taskId}`;
}
