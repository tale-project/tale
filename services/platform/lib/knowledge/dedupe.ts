import type { KnowledgeHit } from './types';

/**
 * Drop a passage the caller has already been given, keeping the best-scoring
 * one.
 *
 * The same text can sit in the corpus twice — the same file uploaded as two
 * documents, or a paragraph two documents share. Both copies match, and a
 * bounded result set then spends two of its slots saying one thing while a
 * different answer falls off the end.
 *
 * Runs AFTER the admission re-check, deliberately. Deduping first could keep
 * a copy the caller cannot read and drop the readable one, and the re-check
 * would then remove what was kept — losing the passage entirely rather than
 * showing it once. Fusion has already sorted by score, so the first
 * occurrence is the best one. Pure, so retrieval can call it on a fused pool
 * and on a cached one alike.
 */
export function dropRepeatedPassages<Hit extends KnowledgeHit>(
  hits: readonly Hit[],
): Hit[] {
  const seen = new Set<string>();
  const kept: Hit[] = [];
  for (const hit of hits) {
    // Keyed on the text a caller actually reads. Whitespace is normalized so
    // two copies that differ only in how their source wrapped lines still
    // count as one.
    const key = `${hit.corpus}\u0000${hit.text.replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(hit);
  }
  return kept;
}
