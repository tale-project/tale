/** Case-folded first, so `blocked` comes before `Hold`; the spelling breaks a
 * tie. Code-unit order, the same whatever the database's collation. */
export function compareLabelNames(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
