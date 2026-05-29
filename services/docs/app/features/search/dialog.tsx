import {
  type SearchCommandLabels,
  SearchCommand,
  type SearchResult,
  urlToBreadcrumb,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { createDocsSearchSource } from './source';

interface SearchDialogProps {
  /** Current locale used to pick the right static index. */
  locale: string;
  /** Optional base URL for the static index files (defaults to `/`). */
  baseUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Override surface-specific labels; the rest resolve from the `search`
   *  i18n namespace (docs' own keys win over the `@tale/ui` defaults). */
  labels?: Partial<SearchCommandLabels>;
  /** Map a section key (e.g. "platform") to a localised label. */
  sectionLabel?: (sectionKey: string) => string;
}

/**
 * Docs search — a thin wrapper over the shared `@tale/ui` `SearchCommand`,
 * wired to the static MiniSearch index via {@link createDocsSearchSource}. The
 * palette UX (skeleton, recents, keyboard nav, a11y, grouping, snippet) lives
 * in `@tale/ui` so docs and the platform behave identically.
 */
export function SearchDialog({
  locale,
  baseUrl = '',
  open,
  onOpenChange,
  labels,
  sectionLabel,
}: SearchDialogProps) {
  const navigate = useNavigate();

  const source = useMemo(
    () => createDocsSearchSource({ locale, baseUrl }),
    [locale, baseUrl],
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
      labels={labels}
      getGroupLabel={sectionLabel}
      getBreadcrumb={getBreadcrumb}
      recentsStorageKey="tale.docs.recentSearches.v1"
      onSelect={onSelect}
    />
  );
}
