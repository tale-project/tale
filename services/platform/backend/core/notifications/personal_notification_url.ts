/**
 * Deep-link builder for actionable notification email — mirrors the in-app
 * `personalNotificationTarget` routing. Pure (the caller supplies or
 * defaults the site URL), shared by the 0.4 email action and the 0.5
 * backend's email sink.
 */

const SITE_URL = process.env.SITE_URL ?? 'http://127.0.0.1:3000';

/** Mirrors the in-app personal notification deep-link builder. */
export function buildPersonalNotificationUrl(args: {
  organizationId: string;
  taskId?: string;
  params?: Record<string, unknown>;
  siteUrl?: string;
}): string | null {
  const projectId = args.params?.projectId;
  const threadId = args.params?.threadId;
  const base = (args.siteUrl ?? SITE_URL).replace(/\/$/, '');

  if (args.params?.chat === true && typeof threadId === 'string') {
    return `${base}/dashboard/${args.organizationId}/chat/${encodeURIComponent(threadId)}`;
  }
  const conversationId = args.params?.conversationId;
  if (typeof conversationId === 'string') {
    const status =
      typeof args.params?.conversationStatus === 'string'
        ? args.params.conversationStatus
        : 'open';
    return `${base}/dashboard/${args.organizationId}/conversations/${encodeURIComponent(status)}?conversation=${encodeURIComponent(conversationId)}`;
  }
  // Document-review emails mirror `personalNotificationTarget`: project
  // files open inside their Files tab, library documents in the org list,
  // both with the preview (`doc`) opened on the frozen artifact.
  const documentId = args.params?.documentId;
  if (typeof documentId === 'string') {
    const docSearch = `doc=${encodeURIComponent(documentId)}`;
    if (typeof projectId === 'string') {
      const folderId = args.params?.folderId;
      const folderSearch =
        typeof folderId === 'string'
          ? `&folderId=${encodeURIComponent(folderId)}`
          : '';
      return `${base}/dashboard/${args.organizationId}/projects/${projectId}/files?${docSearch}${folderSearch}`;
    }
    return `${base}/dashboard/${args.organizationId}/documents?${docSearch}`;
  }
  if (args.taskId && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}/tasks?task=${args.taskId}`;
  }
  // Legacy discussion-mention rows (threadId + projectId): their route is
  // gone, so the email lands on the project's Tasks board — parity with
  // `personalNotificationTarget`.
  if (typeof threadId === 'string' && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}/tasks`;
  }
  return null;
}
