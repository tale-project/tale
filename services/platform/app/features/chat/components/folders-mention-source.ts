import { type SearchResult, type SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import type { KbMention } from '../hooks/use-kb-mentions';

interface FoldersMentionSourceConfig {
  organizationId: string;
  /** The thread's project — its folders join the hub folders in results. */
  projectId?: Id<'projects'>;
}

/**
 * Folder twin of `createDocumentsMentionSource`: a {@link SearchSource} over
 * Knowledge Hub folders (plus the current project's folders in a project
 * thread), backed by `searchFoldersForMention`. Skipped entirely while the
 * picker is closed. Memoised by the caller for stable hook identity.
 */
export function createFoldersMentionSource(
  config: FoldersMentionSourceConfig,
): SearchSource<KbMention> {
  const { organizationId, projectId } = config;
  return (query, { active }) => {
    const trimmed = query.trim();

    const { data: rows } = useConvexQuery(
      api.folders.queries.searchFoldersForMention,
      active ? { organizationId, query: trimmed, projectId } : 'skip',
    );

    const results = useMemo<SearchResult<KbMention>[]>(
      () =>
        (rows ?? []).map(
          (row): SearchResult<KbMention> => ({
            id: row.folderId,
            title: row.name,
            subtitle: row.parentPath || undefined,
            data: {
              kind: 'folder',
              folderId: row.folderId,
              title: row.name,
              parentPath: row.parentPath,
            },
          }),
        ),
      [rows],
    );

    const status = !active ? 'idle' : rows === undefined ? 'loading' : 'ready';

    return { results, status };
  };
}
