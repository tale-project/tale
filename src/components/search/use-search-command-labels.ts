import { useMemo } from 'react';

import { useT } from '../../i18n/client';
import type { SearchCommandLabels } from './types';

/**
 * Resolve {@link SearchCommandLabels} from the shared `search` i18n namespace
 * (shipped by `@tale/ui`, overridable per-service since service keys win on
 * merge — see `init-service.ts`). There is no hardcoded English fallback: the
 * strings live in `@tale/ui/i18n/messages/*.json` and are referenced by key.
 *
 * `overrides` lets a surface swap the handful of strings that genuinely differ
 * between palettes (e.g. a chat-specific `placeholder`/`title`) using its own
 * translated copy, while inheriting all the shared chrome. An `undefined`
 * override value falls back to the namespace key (per-key `??`).
 */
export function useSearchCommandLabels(
  overrides?: Partial<SearchCommandLabels>,
): SearchCommandLabels {
  const { t } = useT('search');
  return useMemo<SearchCommandLabels>(
    () => ({
      title: overrides?.title ?? t('title'),
      placeholder: overrides?.placeholder ?? t('placeholder'),
      empty: overrides?.empty ?? t('empty'),
      emptyHint: overrides?.emptyHint ?? t('emptyHint'),
      keepTyping: overrides?.keepTyping ?? t('keepTyping'),
      noResultsTitle: overrides?.noResultsTitle ?? t('noResultsTitle'),
      noResultsHint: overrides?.noResultsHint ?? t('noResultsHint'),
      errorTitle: overrides?.errorTitle ?? t('errorTitle'),
      errorHint: overrides?.errorHint ?? t('errorHint'),
      resultsGroup: overrides?.resultsGroup ?? t('resultsGroup'),
      loading: overrides?.loading ?? t('loading'),
      close: overrides?.close ?? t('close'),
      recent: overrides?.recent ?? t('recent'),
      clearRecent: overrides?.clearRecent ?? t('clearRecent'),
      removeRecent: overrides?.removeRecent ?? t('removeRecent'),
      tipNavigate: overrides?.tipNavigate ?? t('tipNavigate'),
      tipSelect: overrides?.tipSelect ?? t('tipSelect'),
      tipClose: overrides?.tipClose ?? t('tipClose'),
      resultCount:
        overrides?.resultCount ?? ((count: number) => t('results', { count })),
    }),
    [t, overrides],
  );
}
