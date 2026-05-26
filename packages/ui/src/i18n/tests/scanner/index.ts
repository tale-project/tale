/**
 * Public scanner surface. Used by every check and exposed on `CheckContext`.
 *
 * `Scanner.fragments(filter?)` yields every fragment matching the filter.
 * Internally it reads (and caches) the sources passed at construction time.
 */

import { getCached, setCached } from './cache';
import { scanJson } from './json';
import { scanMarkdown } from './markdown';
import type { Fragment, FragmentFilter, Source } from './types';

export type {
  Fragment,
  FragmentFilter,
  JsonSource,
  MarkdownSource,
  Source,
} from './types';
export { applyJsonMasks, applyMarkdownMasks } from './mask';
export { walkDocsRoot, walkMessagesDir } from './walk';
export { lexIcu } from './icu-lexer';
export type { IcuShape } from './icu-lexer';
export { extractHeadingSlugs, slugifyHeading } from './slug';

export interface Scanner {
  /** All sources the scanner knows about. */
  readonly sources: ReadonlyArray<Source>;
  /** Iterate fragments, optionally filtered by surface/locale. */
  fragments(filter?: FragmentFilter): Iterable<Fragment>;
  /** Yield the sources matching the filter (no fragment scan). */
  matchingSources(filter?: FragmentFilter): ReadonlyArray<Source>;
}

export function createScanner(
  sources: ReadonlyArray<Source>,
  repoRoot: string,
): Scanner {
  return {
    sources,
    *fragments(filter?: FragmentFilter): Iterable<Fragment> {
      for (const source of sources) {
        if (filter?.surface && filter.surface !== source.kind) continue;
        if (filter?.locale && filter.locale !== source.locale) continue;
        let fragments = getCached(source);
        if (!fragments) {
          fragments =
            source.kind === 'json'
              ? scanJson(source, repoRoot)
              : scanMarkdown(source, repoRoot);
          setCached(source, fragments);
        }
        for (const fragment of fragments) yield fragment;
      }
    },
    matchingSources(filter?: FragmentFilter) {
      return sources.filter((s) => {
        if (filter?.surface && filter.surface !== s.kind) return false;
        if (filter?.locale && filter.locale !== s.locale) return false;
        return true;
      });
    },
  };
}
