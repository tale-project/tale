/**
 * The syntax verdict for one parsed unit: acorn locates, the CodeRunner
 * decides.
 *
 * A unit acorn accepts is valid without asking the runner — one IPC round
 * trip fewer per expression on every validation. A unit acorn rejects is
 * confirmed by the runner when one is installed: if the runner compiles it,
 * the code is valid and only marked opaque (no analysis runs on it); if not,
 * the runner's own sentence is the error, located at acorn's range. Without
 * a runner (a browser) acorn's verdict stands.
 */

import { codeRunner, hasCodeRunner } from '../runner';
import type { ExprUnit } from '../syntax/sources';

/** The syntax error's sentence, or null when the unit is valid code. */
export async function syntaxError(
  unit: ExprUnit,
  kind: 'expr' | 'body',
): Promise<string | null> {
  if (unit.parse.ok || unit.opaque === true) return null;
  if (!hasCodeRunner()) return unit.parse.message;
  const verdict =
    kind === 'body'
      ? await codeRunner().checkBody(unit.source)
      : await codeRunner().checkExpr(unit.source);
  if (verdict === null) {
    unit.opaque = true;
    return null;
  }
  return verdict;
}

/** Where a unit's syntax error is: the parser's range, or the whole unit
 * when only the runner rejected it. */
export function errorRange(unit: ExprUnit): [number, number] {
  return unit.parse.ok ? unit.range : unit.parse.range;
}

/** Whether the unit's references may be judged: it parsed, so its sites
 * come from the scope-aware walk rather than the token scan. */
export function analyzable(unit: ExprUnit): boolean {
  return unit.parse.ok;
}
