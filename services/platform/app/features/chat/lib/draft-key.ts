/** One draft slot per conversation (and one for the new-chat index), scoped
 * to user + org so shared machines never leak text across accounts. */
export function chatDraftKey(
  userId: string | undefined,
  organizationId: string,
  threadId?: string,
) {
  const prefix =
    userId !== undefined
      ? `chat-draft-${userId}-${organizationId}`
      : `chat-draft-${organizationId}`;
  return threadId !== undefined ? `${prefix}-${threadId}` : `${prefix}-new`;
}
