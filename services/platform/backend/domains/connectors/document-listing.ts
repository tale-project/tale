import type { WorkflowFolderFile } from '../../../lib/connectors/natives/platform-documents.ts';

/**
 * The folder walk behind the workflow `document.list` native, kept free of
 * SQL so the bound is testable: breadth-first over a hub folder (and, when
 * asked, its subfolders down to `maxDepth`), collecting at most `cap` files
 * and telling the truth about the cut.
 *
 * `truncated` is conservative — true whenever the listing MAY be incomplete:
 * a folder held more rows than the room left under the cap, or the cap was
 * reached while folders were still queued (their contents were never read).
 * A listing that says `truncated: false` is the whole tree it was asked for.
 */

export interface WorkflowFolderLoaders {
  /** The folder's stored files, newest first, at most `limit`; `truncated`
   * when the folder holds more than that. */
  filesIn(
    folderId: string | null,
    limit: number,
  ): Promise<{ files: WorkflowFolderFile[]; truncated: boolean }>;
  /** The folder's direct subfolders (name → id). */
  subfoldersOf(
    folderId: string | null,
  ): Promise<{ id: string; name: string }[]>;
}

export async function collectWorkflowFolderFiles(
  loaders: WorkflowFolderLoaders,
  args: {
    rootFolderId: string | null;
    recursive: boolean;
    cap: number;
    maxDepth: number;
  },
): Promise<{ files: WorkflowFolderFile[]; truncated: boolean }> {
  const files: WorkflowFolderFile[] = [];
  let truncated = false;
  const queue: { folderId: string | null; prefix: string; depth: number }[] = [
    { folderId: args.rootFolderId, prefix: '', depth: 0 },
  ];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const room = args.cap - files.length;
    if (room <= 0) {
      // Folders left unread: the listing may be missing their files.
      truncated = true;
      break;
    }
    const page = await loaders.filesIn(next.folderId, room);
    if (page.truncated) truncated = true;
    for (const file of page.files) {
      files.push(
        next.prefix === ''
          ? file
          : { ...file, name: `${next.prefix}/${file.name}` },
      );
    }
    if (!args.recursive) continue;
    if (next.depth >= args.maxDepth) {
      // A deeper tree than the hub itself allows — nothing legitimate lives
      // there, but say so rather than pretend the walk was whole.
      truncated = true;
      continue;
    }
    for (const sub of await loaders.subfoldersOf(next.folderId)) {
      queue.push({
        folderId: sub.id,
        prefix: next.prefix === '' ? sub.name : `${next.prefix}/${sub.name}`,
        depth: next.depth + 1,
      });
    }
  }
  return { files, truncated };
}
