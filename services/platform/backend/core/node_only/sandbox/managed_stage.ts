import { createHash } from 'node:crypto';

import { sessionDeleteFiles, sessionListFiles } from './helpers/session_client';

/** Immutable blob identities are scoped to the authenticated organization;
 * signed URL expiry never changes the cache identity. The daemon also hashes
 * actual destination bytes before a hit, so an agent edit is restored. */
export function stageBlobCacheKey(
  organizationId: string,
  blobRef: string,
): string {
  return createHash('sha256')
    .update(organizationId)
    .update('\0')
    .update(blobRef)
    .digest('hex');
}

/** Reconcile only a caller-owned staging tree. Keep current files so the
 * daemon can verify their hashes instead of downloading them again; removed
 * and renamed inputs disappear before the next turn reads them. */
export async function pruneManagedStageFiles(
  sessionId: string,
  root: string,
  paths: readonly string[],
): Promise<void> {
  const absolute = (path: string) => {
    if (path === '/agent' || path.startsWith('/agent/')) return path;
    if (path.startsWith('/')) throw new Error('Invalid managed staging path');
    return `/agent/${path}`;
  };
  const base = absolute(root).replace(/\/+$/, '');
  if (
    base === '/agent' ||
    base.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Invalid managed staging root');
  }
  const files = new Set(paths.map(absolute));
  const directories = new Set<string>();
  for (const path of files) {
    if (
      !path.startsWith(`${base}/`) ||
      path.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new Error('Staged file leaves its managed root');
    }
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent.length >= base.length) {
      directories.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  const visit = [base];
  const stale: string[] = [];
  for (const directory of visit) {
    for (const entry of (await sessionListFiles(sessionId, directory)) ?? []) {
      if (
        entry.name === '.' ||
        entry.name === '..' ||
        /[/\\]/.test(entry.name)
      ) {
        throw new Error('Invalid managed staging directory entry');
      }
      const path = `${directory}/${entry.name}`;
      if (entry.type === 'dir' && directories.has(path)) visit.push(path);
      else if (entry.type !== 'file' || !files.has(path)) stale.push(path);
    }
  }
  if (stale.length > 0) {
    const result = await sessionDeleteFiles(sessionId, stale);
    if (result.skipped.length > 0)
      throw new Error('Could not remove obsolete staged files');
  }
}
