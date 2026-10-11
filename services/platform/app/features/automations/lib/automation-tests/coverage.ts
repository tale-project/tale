/**
 * Which of an automation's possible paths its tests go down: each test's
 * latest result names the path its run took (`TestResult.path`, the
 * engine's stable id such as `when:triage=0|fail:propose=1`). Only a result
 * that still holds counts — one changed since says nothing about the draft.
 */

import type { TestOutcome } from './test-results';

/** The path a result's run took, when it says. */
function pathOf(outcome: TestOutcome): string | undefined {
  if (outcome.kind === 'run') return outcome.result.path?.id;
  if (outcome.kind === 'report') return outcome.result.path;
  return undefined;
}

/** Each path some test goes down, with the names of those tests, in the
 * tests' order. */
export function pathCoverage(
  rows: ReadonlyArray<{ name: string; outcome: TestOutcome }>,
): ReadonlyMap<string, readonly string[]> {
  const byPath = new Map<string, string[]>();
  for (const { name, outcome } of rows) {
    if (outcome.kind === 'none' || outcome.stale) continue;
    const path = pathOf(outcome);
    if (path === undefined) continue;
    const names = byPath.get(path) ?? [];
    names.push(name);
    byPath.set(path, names);
  }
  return byPath;
}

/** How many of `paths` the tests go down. */
export function coveredCount(
  coverage: ReadonlyMap<string, readonly string[]>,
  paths: ReadonlyArray<{ id: string }>,
): number {
  return paths.filter((path) => coverage.has(path.id)).length;
}
