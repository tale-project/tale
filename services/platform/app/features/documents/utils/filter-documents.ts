import {
  audienceMatcher,
  MY_TEAMS_AUDIENCE,
  ORG_WIDE_AUDIENCE,
} from '@/app/features/settings/teams/lib/audience-filter';
import { filterByTextSearch } from '@/lib/utils/filtering';
import type { DocumentItem, RagStatus } from '@/types/documents';

export { MY_TEAMS_AUDIENCE, ORG_WIDE_AUDIENCE };

export interface DocumentFilterOptions {
  /**
   * The Teams filter's selection: team ids, and/or the two audience tokens
   * `ORG_WIDE_AUDIENCE` (rows with no team) and `MY_TEAMS_AUDIENCE` (rows
   * carrying any of `myTeamIds`). A row matches when it satisfies ANY
   * selected value.
   */
  selectedTeamIds: string[];
  /** The viewer's own team ids — what `MY_TEAMS_AUDIENCE` expands to. */
  myTeamIds?: readonly string[];
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
    const matches = audienceMatcher(
      options.selectedTeamIds,
      options.myTeamIds ?? [],
    );
    filtered = filtered.filter((doc) => matches(doc.teamIds));
    filteredFolders = filteredFolders.filter((folder) =>
      matches(folder.teamIds),
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
