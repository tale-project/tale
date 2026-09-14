import {
  SearchCommand,
  type SearchResult,
  urlToBreadcrumb,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { createUiDocsSearchSource } from './source';

interface SearchDialogProps {
  /** Base URL for the static index file (defaults to the site root). */
  baseUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Map a section key (e.g. `components`) to its navigation label. */
  sectionLabel?: (sectionKey: string) => string;
}

/**
 * Search — a thin wrapper over the shared `@tale/ui` `SearchCommand`, wired to
 * the static MiniSearch index. The palette's behaviour (skeleton, recents,
 * keyboard navigation, grouping, snippets) lives in the package, so this site
 * searches exactly the way the product does.
 */
export function SearchDialog({
  baseUrl = '',
  open,
  onOpenChange,
  sectionLabel,
}: SearchDialogProps) {
  const navigate = useNavigate();

  const source = useMemo(
    () => createUiDocsSearchSource({ baseUrl }),
    [baseUrl],
  );

  const getBreadcrumb = useCallback(
    (result: SearchResult) => urlToBreadcrumb(result.href, sectionLabel),
    [sectionLabel],
  );

  const onSelect = useCallback(
    (result: SearchResult) => {
      if (result.href)
        // oxlint-disable-next-line typescript/no-explicit-any -- runtime nav target
        void navigate({ to: result.href } as any);
    },
    [navigate],
  );

  return (
    <SearchCommand
      open={open}
      onOpenChange={onOpenChange}
      source={source}
      getGroupLabel={sectionLabel}
      getBreadcrumb={getBreadcrumb}
      recentsStorageKey="tale.ui-docs.recentSearches.v1"
      onSelect={onSelect}
    />
  );
}
