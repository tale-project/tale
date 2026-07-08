/**
 * Backend search for the chat composer's `@` folder mention picker — the
 * folder twin of `documents/search_documents_for_mention.ts`.
 *
 * Two scopes feed the picker:
 *  - Knowledge Hub folders the user can see (`hasKnowledgeHubFolderAccess`;
 *    project folders are never hub rows), and
 *  - the current thread's project folders, when the composer is in a
 *    project thread (`projectId` — access to the project itself is verified
 *    by the query wrapper before this helper runs).
 *
 * Folders carry no search index; an org holds at most a few hundred, so a
 * bounded scan + in-memory name match mirrors what the fuzzy folder-path
 * resolver does (`documents/list_documents_for_agent.ts`). Prefix matches
 * rank before contains-matches, alphabetical within each band.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { hasKnowledgeHubFolderAccess } from './access';
import { buildFolderPath } from './queries';

export const MENTION_FOLDER_RESULT_LIMIT = 10;
/** Scan ceiling per scope — a runaway-org backstop, not a product limit. */
const MAX_FOLDER_SCAN = 1000;

export interface MentionFolderResult {
  folderId: Id<'folders'>;
  name: string;
  /** Slash-joined ancestor path (parent chain only), picker subtitle. */
  parentPath?: string;
  scope: 'hub' | 'project';
}

interface SearchFoldersForMentionArgs {
  organizationId: string;
  /** Raw query the user typed after `@`. Empty lists the first folders. */
  term: string;
  userTeamIds: string[];
  /** Include this project's folders (composer is in one of its threads). */
  projectId?: Id<'projects'>;
}

function rankAndFilter(
  folders: Doc<'folders'>[],
  term: string,
): Doc<'folders'>[] {
  const needle = term.trim().toLowerCase();
  const matches = needle
    ? folders.filter((f) => f.name.toLowerCase().includes(needle))
    : folders;
  return matches.sort((a, b) => {
    if (needle) {
      const aPrefix = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function searchFoldersForMention(
  ctx: QueryCtx,
  args: SearchFoldersForMentionArgs,
): Promise<MentionFolderResult[]> {
  const teamSet = new Set(args.userTeamIds);

  const hubFolders: Doc<'folders'>[] = [];
  const hubScan = await ctx.db
    .query('folders')
    .withIndex('by_org_parent_name', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .take(MAX_FOLDER_SCAN);
  for (const folder of hubScan) {
    if (!hasKnowledgeHubFolderAccess(folder, teamSet)) continue;
    hubFolders.push(folder);
  }

  let projectFolders: Doc<'folders'>[] = [];
  if (args.projectId) {
    projectFolders = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId),
      )
      .take(MAX_FOLDER_SCAN);
  }

  // Project folders first: in a project thread they are the likelier
  // target, and the two scopes never contain the same folder.
  const ranked = [
    ...rankAndFilter(projectFolders, args.term).map(
      (f) => [f, 'project'] as const,
    ),
    ...rankAndFilter(hubFolders, args.term).map((f) => [f, 'hub'] as const),
  ].slice(0, MENTION_FOLDER_RESULT_LIMIT);

  const results: MentionFolderResult[] = [];
  for (const [folder, scope] of ranked) {
    let parentPath: string | undefined;
    if (folder.parentId) {
      parentPath = await buildFolderPath(ctx, folder.parentId);
    }
    results.push({
      folderId: folder._id,
      name: folder.name,
      parentPath,
      scope,
    });
  }
  return results;
}
