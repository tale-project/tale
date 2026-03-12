import type { DocumentItem, RagStatus } from '@/types/documents';

import { filterByTextSearch } from '@/lib/utils/filtering';

export interface DocumentFilterOptions {
  selectedTeamId?: string | null;
  selectedTeamIds: string[];
  selectedRagStatuses: string[];
  selectedSources: string[];
  searchQuery: string;
  ragStatusFilterMap: Record<string, RagStatus[]>;
}

export function filterDocumentResults(
  documents: DocumentItem[],
  folders: DocumentItem[],
  options: DocumentFilterOptions,
): DocumentItem[] {
  let filtered = documents;
  let filteredFolders = folders;

  if (options.selectedTeamId) {
    const teamId = options.selectedTeamId;
    filtered = filtered.filter(
      (doc) => !doc.teamIds?.length || doc.teamIds.includes(teamId),
    );
    filteredFolders = filteredFolders.filter(
      (folder) => !folder.teamIds?.length || folder.teamIds.includes(teamId),
    );
  }

  if (options.selectedRagStatuses.length > 0) {
    const allowedStatuses = new Set(
      options.selectedRagStatuses.flatMap(
        (key) => options.ragStatusFilterMap[key] ?? [],
      ),
    );
    filtered = filtered.filter((doc) => {
      const status = doc.ragStatus ?? 'not_indexed';
      return allowedStatuses.has(status);
    });
  }

  if (options.selectedSources.length > 0) {
    const sourceSet = new Set(options.selectedSources);
    filtered = filtered.filter(
      (doc) => doc.sourceProvider && sourceSet.has(doc.sourceProvider),
    );
  }

  if (options.selectedTeamIds.length > 0) {
    const teamIdSet = new Set(options.selectedTeamIds);
    filtered = filtered.filter((doc) =>
      doc.teamIds?.some((id) => teamIdSet.has(id)),
    );
    filteredFolders = filteredFolders.filter((folder) =>
      folder.teamIds?.some((id) => teamIdSet.has(id)),
    );
  }

  if (options.searchQuery) {
    const searchedFolders = filterByTextSearch(
      filteredFolders,
      options.searchQuery,
      ['name'],
    );
    filtered = filterByTextSearch(filtered, options.searchQuery, ['name']);
    return [...searchedFolders, ...filtered];
  }

  return [...filteredFolders, ...filtered];
}
