/**
 * The one order of task ranks: by UTF-16 code unit, as `rankBetween` builds
 * and checks them and as the `(project_id, status, rank)` index answers.
 * Never `localeCompare`: a collation can treat a letter pair as one letter
 * (Hungarian `zs`, Croatian `lj`, Danish `aa`, Czech `ch`), and counted
 * ranks contain every pair, so a board would sort a column differently from
 * the server for some readers and compute drops from the wrong neighbours.
 */
export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
