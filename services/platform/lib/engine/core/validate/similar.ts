/**
 * "Did you mean" support for unknown names (node ids, type names, input
 * keys): the closest candidate by edit distance, under a conservative cap so
 * unrelated names are never suggested.
 */

/** Levenshtein distance, two-row dynamic programming. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The closest candidate within the cap (1 edit for names of up to four
 * characters, 2 otherwise), or undefined when nothing is plausibly a typo.
 * Ties resolve to the first candidate in iteration order, so suggestions
 * are deterministic.
 */
export function closestName(
  target: string,
  candidates: Iterable<string>,
): string | undefined {
  const cap = target.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = cap + 1;
  for (const candidate of candidates) {
    if (candidate === target) continue;
    if (Math.abs(candidate.length - target.length) >= bestDistance) continue;
    const distance = editDistance(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
