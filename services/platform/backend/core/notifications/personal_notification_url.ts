/**
 * Deep-link builder for actionable notification email — mirrors the in-app
 * `personalNotificationTarget` routing. The caller may pass `siteUrl` to pin
 * the origin; otherwise it comes from the deployment's `SITE_URL`.
 */

import {
  canonicalOrigin,
  publicBaseUrlFor,
} from '../lib/helpers/public_origin';

/**
 * Dev fallback when `SITE_URL` is unset — the local app origin, the same
 * literal this module has always used. A real deployment always has one:
 * `backend/env.ts` validates it at boot.
 */
const FALLBACK_ORIGIN = 'http://127.0.0.1:3000';

/**
 * `<origin><BASE_PATH>` for a notification deep link, read at CALL time.
 * It used to be a module-load constant, which froze whatever the env held at
 * import — wrong for a worker that imports before the container's env is in
 * place, and untestable without re-importing the module. `BASE_PATH` was
 * ignored outright, so every link on a subpath deployment 404'd.
 */
function notificationBase(siteUrl?: string): string {
  const origin = (siteUrl ?? canonicalOrigin() ?? FALLBACK_ORIGIN).replace(
    /\/$/,
    '',
  );
  return publicBaseUrlFor(origin);
}

/** Mirrors the in-app personal notification deep-link builder. */
export function buildPersonalNotificationUrl(args: {
  organizationId: string;
  taskId?: string;
  params?: Record<string, unknown>;
  siteUrl?: string;
}): string {
  const projectId = args.params?.projectId;
  const threadId = args.params?.threadId;
  const base = notificationBase(args.siteUrl);

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
    return `${base}/dashboard/${args.organizationId}/projects/${encodeURIComponent(projectId)}/tasks?task=${encodeURIComponent(args.taskId)}`;
  }
  // Legacy discussion-mention rows (threadId + projectId): their route is
  // gone, so the email lands on the project's Tasks board — parity with
  // `personalNotificationTarget`.
  if (typeof threadId === 'string' && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}/tasks`;
  }
  // Never null: an actionable email always carries a way in. A row with no
  // entity context (a legacy row written before its project was stamped)
  // lands on the org dashboard rather than shipping a link-less email that
  // names something the reader then has to go and find by hand.
  return `${base}/dashboard/${args.organizationId}`;
}
