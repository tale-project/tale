'use client';

import { useT } from '@tale/ui/i18n/client';
import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
  urlToBreadcrumb,
} from '@tale/ui/search';
import { createStaticIndexSource } from '@tale/ui/search/static-index/source';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

export interface DocsSearchConfig {
  /** URL of the site's static search index, deploy base included. */
  indexUrl: string;
  /** localStorage key recent searches persist under. */
  recentsStorageKey: string;
  /** Map a section key (e.g. "platform") to its navigation label. */
  sectionLabel?: (sectionKey: string) => string;
  /** Ancestor trail shown under a result, e.g. the navigation groups above
   *  its page. Return `undefined` to fall back to the result's URL segments,
   *  labelled through {@link sectionLabel}. */
  breadcrumb?: (result: SearchResult) => string[] | undefined;
}

export interface DocsSearchDialogProps extends DocsSearchConfig {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Docs search — a thin wrapper over the shared `SearchCommand`, wired to the
 * site's static MiniSearch index. The palette UX (skeleton, recents, keyboard
 * nav, a11y, grouping, snippet) lives in the search family, so the docs sites
 * and the platform search the same way; this wrapper only adds the
 * documentation's own copy and the router navigation.
 */
export function DocsSearchDialog({
  open,
  onOpenChange,
  indexUrl,
  recentsStorageKey,
  sectionLabel,
  breadcrumb,
}: DocsSearchDialogProps) {
  const navigate = useNavigate();
  const { t } = useT('docs');

  const source = useMemo(
    () => createStaticIndexSource({ indexUrl }),
    [indexUrl],
  );

  const labels = useMemo<Partial<SearchCommandLabels>>(
    () => ({
      title: t('search.title'),
      placeholder: t('search.placeholder'),
      empty: t('search.empty'),
      emptyHint: t('search.emptyHint'),
      noResultsHint: t('search.noResultsHint'),
    }),
    [t],
  );

  const getBreadcrumb = useCallback(
    (result: SearchResult) =>
      breadcrumb?.(result) ?? urlToBreadcrumb(result.href, sectionLabel),
    [breadcrumb, sectionLabel],
  );

  const onSelect = useCallback(
    (result: SearchResult) => {
      if (result.href)
        // oxlint-disable-next-line typescript/no-explicit-any, typescript-eslint/no-unsafe-type-assertion -- runtime-typed router target
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
      recentsStorageKey={recentsStorageKey}
      onSelect={onSelect}
    />
  );
}
