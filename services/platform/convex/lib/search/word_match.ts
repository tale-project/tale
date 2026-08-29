/**
 * Word matching, added ALONGSIDE an entity's existing phrase match.
 *
 * The chat legs pass a natural-language question, and the entity queries
 * compare that whole string as one substring — so "do we have red running
 * shoes" only matches text that literally contains the whole phrase, and finds
 * nothing. Splitting it into words fixes that.
 *
 * Used as an OR, never as a replacement. The phrase check reaches fields this
 * format cannot express — a product's translated name and description among
 * them — so swapping to words alone would quietly shrink what is searchable.
 * Running both keeps everything that worked and adds the multi-word case.
 *
 * `'any'` mode is what makes a question usable: it drops stopwords and
 * one-character tokens, and requires a word-START match rather than any
 * substring, so an OR over tokens does not pull in every row containing a
 * common fragment.
 */

import type { TableNames } from '../../_generated/dataModel';
import type { Doc } from '../../_generated/dataModel';
import { rowMatches } from './relevance';
import type { SearchStrategy } from './types';

/** True when any meaningful word of `term` matches `row` under the strategy. */
export function matchesAnyWord<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  term: string,
): boolean {
  const raw = term.trim();
  if (raw === '') return false;
  return rowMatches(row, strategy, raw.toLowerCase(), raw, 'any');
}
