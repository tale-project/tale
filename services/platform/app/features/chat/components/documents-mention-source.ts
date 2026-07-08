import { type SearchResult, type SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import type { KbMention } from '../hooks/use-kb-mentions';

interface DocumentsMentionSourceConfig {
  organizationId: string;
}

/**
 * Build a {@link SearchSource} over RAG-indexed, user-accessible knowledge
 * documents for the composer's `@`-mention picker. Backed by the
 * `searchDocumentsForMention` query (title search through the shared
 * `runEntitySearch` seam); skipped entirely while the picker is closed.
 *
 * Returned from a `useMemo` so its identity stays stable across renders
 * (the SearchSource contract — it is called as a hook).
 */
export function createDocumentsMentionSource(
  config: DocumentsMentionSourceConfig,
): SearchSource<KbMention> {
  const { organizationId } = config;
  return (query, { active }) => {
    const trimmed = query.trim();

    const { data: rows } = useConvexQuery(
      api.documents.queries.searchDocumentsForMention,
      active ? { organizationId, query: trimmed } : 'skip',
    );

    const results = useMemo<SearchResult<KbMention>[]>(
      () =>
        (rows ?? []).map(
          (row): SearchResult<KbMention> => ({
            id: row.documentId,
            title: row.title,
            subtitle: row.folderPath || undefined,
            data: {
              kind: 'document',
              documentId: row.documentId,
              fileId: row.fileId,
              title: row.title,
              fileType: row.fileType,
              fileSize: row.fileSize,
              extension: row.extension,
              folderPath: row.folderPath,
            },
          }),
        ),
      [rows],
    );

    const status = !active ? 'idle' : rows === undefined ? 'loading' : 'ready';

    return { results, status };
  };
}
