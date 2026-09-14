import {
  type SearchCommandLabels,
  SearchCommand,
  type SearchResult,
  urlToBreadcrumb,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { navGroupTrail } from '@/lib/content/nav';
import { useT } from '@/lib/i18n/client';

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
  const { t: tNav } = useT('nav');

  const source = useMemo(
    () => createDocsSearchSource({ locale, baseUrl }),
    [locale, baseUrl],
  );

  const getBreadcrumb = useCallback(
    (result: SearchResult) => {
      // Index IDs carry locale:slug, independent of the deployment base URL.
      // Reuse the sidebar's hierarchy, including groups without an index page.
      const slug = result.id.slice(result.id.indexOf(':') + 1);
      const groups = navGroupTrail(slug);
      return groups.length > 0
        ? groups.map((key) => tNav(key.replace(/^nav\./, '')))
        : urlToBreadcrumb(result.href, sectionLabel);
    },
    [sectionLabel, tNav],
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
