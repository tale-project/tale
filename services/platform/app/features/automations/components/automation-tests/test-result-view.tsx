'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { DataDiff, type DiffResult } from '@tale/ui/data-diff';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Eye } from 'lucide-react';
import { useMemo } from 'react';

import type { NodeTrace } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import type { TestRow } from '../../hooks/use-automation-tests';
import {
  failureSentence,
  isWholeFailure,
  type AnyTestFailure,
  type TestFailureView,
  type TestTextContext,
} from '../../lib/automation-tests/test-text';
import {
  testRunOf,
  transientTrace,
} from '../../lib/automation-tests/transient-run';
import { nodeTitle } from '../../lib/node-face';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the test expects of the output, and how it compares: exactly, or
 * the keys it lists. */
function expectedOutput(
  test: unknown,
): { value: unknown; mode: 'exact' | 'includes' } | null {
  const expect = isRecord(test) ? test.expect : undefined;
  if (!isRecord(expect)) return null;
  if (Object.hasOwn(expect, 'output')) {
    return { value: expect.output, mode: 'exact' };
  }
  if (Object.hasOwn(expect, 'outputIncludes')) {
    return { value: expect.outputIncludes, mode: 'includes' };
  }
  return null;
}

/** The node ids a test stands in for: simulated outputs, failures, then
 * the nodes it picks a scenario for. */
function standInsOf(test: unknown): string[] {
  if (!isRecord(test)) return [];
  const keys = (value: unknown) => (isRecord(value) ? Object.keys(value) : []);
  return [
    ...new Set([
      ...keys(test.mocks),
      ...keys(test.failures),
      ...keys(test.scenarios),
    ]),
  ];
}

/**
 * The stand-ins a run never used, by why. A scenario answers only the
 * calls whose input matches it: one picked for a node the run did not
 * skip went unused because no call matched it. Any other stand-in went
 * unused because the run skipped its node, never got to it, or ran it over
 * no items. A run that keeps no steps cannot say whether it skipped a
 * node, and a scenario picked for one reads as unmatched: no call matched
 * it either way.
 */
function unusedByWhy(
  test: unknown,
  unused: readonly string[],
  trace: readonly NodeTrace[],
): { skipped: string[]; unmatched: string[] } {
  const scenarios =
    isRecord(test) && isRecord(test.scenarios) ? test.scenarios : {};
  const skippedNodes = new Set(
    trace
      .filter((step) => step.status === 'skipped' || step.status === 'not_run')
      .map((step) => step.node),
  );
  const unmatched = unused.filter(
    (id) => Object.hasOwn(scenarios, id) && !skippedNodes.has(id),
  );
  return {
    skipped: unused.filter((id) => !unmatched.includes(id)),
    unmatched,
  };
}

/** The differences a kept report listed, as a diff to read: at most five,
 * each with both values. */
function listedDiff(
  changes: Extract<TestFailureView, { kind: 'output' }>['mismatches'],
): DiffResult {
  const counts: DiffResult['counts'] = {
    added: 0,
    removed: 0,
    changed: 0,
    'type-changed': 0,
    reordered: 0,
    unknown: 0,
    unchanged: 0,
  };
  for (const change of changes) counts[change.kind] += 1;
  return {
    changes,
    counts,
    identical: changes.length === 0,
    truncated: false,
  };
}

export interface TestResultViewProps {
  row: TestRow;
  /** The test as the draft holds it. */
  test: unknown;
  text: Pick<TestTextContext, 'nodeLabel' | 'effectLabel'>;
  /** Shows a node on the canvas, with its inspector. */
  onSelectNode: (nodeId: string) => void;
  /** Lays the test's run over the canvas, step by step. */
  onShowRun?: () => void;
}

/**
 * A test's latest result: whether it still holds, a sentence for each
 * failure with what explains it — the expected and the actual output side
 * by side, what happened instead of an expected action, the node a run
 * failed at — the nodes the test stood in for, and the engine's own words
 * under Technical details.
 */
export function TestResultView({
  row,
  test,
  text,
  onSelectNode,
  onShowRun,
}: TestResultViewProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const ctx = useMemo<TestTextContext>(
    () => ({ t, locale, ...text }),
    [t, locale, text],
  );
  const label = (id: string) => (text.nodeLabel ?? nodeTitle)(id);
  const list = (ids: readonly string[]) =>
    new Intl.ListFormat(locale, { type: 'conjunction' }).format(ids.map(label));
  const { outcome } = row;
  if (outcome.kind === 'none') {
    return (
      <p className="text-muted-foreground text-sm">
        {t('tests.inspector.noResult')}
      </p>
    );
  }
  const { result } = outcome;
  const run = outcome.kind === 'run' ? outcome.result.run : undefined;
  const failures: readonly AnyTestFailure[] = result.failures ?? [];
  const standIns = standInsOf(test);
  const unused =
    outcome.kind === 'run' ? (outcome.result.unusedMocks ?? []) : [];
  const testRun = testRunOf(outcome);
  const { skipped, unmatched } = unusedByWhy(
    test,
    unused,
    testRun === null ? [] : transientTrace(testRun),
  );
  const message = outcome.kind === 'run' ? outcome.result.message : undefined;

  const showNode = (node: string | undefined) =>
    node === undefined || node === '' ? null : (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto self-start px-0"
        onClick={() => onSelectNode(node.split('/')[0] ?? node)}
      >
        {t('tests.result.showNode', { node: label(node) })}
      </Button>
    );

  const detailOf = (failure: TestFailureView) => {
    switch (failure.kind) {
      case 'output': {
        const expected = expectedOutput(test);
        const labels = {
          before: t('tests.result.expected'),
          after: t('tests.result.got'),
        };
        if (run !== undefined && expected !== null) {
          return (
            <DataDiff
              before={expected.value}
              after={run.output}
              {...(expected.mode === 'includes' && {
                options: { mode: 'includes' as const },
              })}
              labels={labels}
              wording="expectation"
              aria-label={t('tests.result.diffLabel')}
            />
          );
        }
        // A kept report has no output: the differences it listed, said
        // the same way, and how many more there were.
        return (
          <div className="flex flex-col gap-1">
            <DataDiff
              before={undefined}
              after={undefined}
              result={listedDiff(failure.mismatches)}
              labels={labels}
              wording="expectation"
              aria-label={t('tests.result.diffLabel')}
            />
            {failure.total > failure.mismatches.length && (
              <p className="text-muted-foreground text-xs">
                {t('tests.result.more', {
                  count: failure.total - failure.mismatches.length,
                })}
              </p>
            )}
          </div>
        );
      }
      case 'effect_missing': {
        const actions = failure.actual.map(
          (effect) =>
            `${(ctx.effectLabel ?? ((id: string) => id))(effect.connector)} (${label(effect.node)})`,
        );
        return (
          <p className="text-muted-foreground text-xs">
            {actions.length === 0
              ? t('tests.result.nothingHappened')
              : t('tests.result.happened', {
                  actions: new Intl.ListFormat(locale, {
                    type: 'conjunction',
                  }).format(actions),
                })}
          </p>
        );
      }
      case 'effect_present':
      case 'node_state':
        return showNode(failure.node);
      case 'run_failed':
      case 'failure_message':
        return showNode(failure.node);
      case 'failed_elsewhere':
        return showNode(failure.actualNode);
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {outcome.stale && (
        <Alert variant="info" description={t('tests.result.stale')} />
      )}
      {result.pass ? (
        <p className="text-foreground text-sm">
          {t('tests.result.passed', { ms: Math.round(result.ms) })}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(failures.length === 0 ? [{ kind: 'unknown' }] : failures).map(
            (failure, at) => (
              // Failures have no ids of their own; their order is stable
              // for one result.
              <li
                key={`${failure.kind}-${at}`}
                className="flex flex-col gap-1.5"
              >
                <p className="text-foreground text-sm">
                  {failureSentence(failure, ctx)}
                </p>
                {isWholeFailure(failure) ? detailOf(failure) : null}
              </li>
            ),
          )}
        </ul>
      )}
      {outcome.kind === 'report' && (
        <p className="text-muted-foreground text-xs">
          {t('tests.result.fromReport')}
        </p>
      )}
      {outcome.kind === 'run' && outcome.result.detailOmitted === true && (
        <p className="text-muted-foreground text-xs">
          {t('tests.result.omitted')}
        </p>
      )}
      {standIns.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t('tests.result.simulated', { nodes: list(standIns) })}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t('tests.result.unused', { nodes: list(skipped) })}
        </p>
      )}
      {unmatched.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t('tests.result.unmatched', {
            count: unmatched.length,
            nodes: list(unmatched),
          })}
        </p>
      )}
      {onShowRun !== undefined && testRun !== null && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={Eye}
          className="self-start"
          onClick={onShowRun}
        >
          {t('tests.showOnCanvas')}
        </Button>
      )}
      {(message !== undefined || failures.length > 0) && (
        <CollapsibleDetails
          variant="compact"
          summary={t('tests.result.technical')}
        >
          <div className="flex flex-col gap-1 pt-2">
            {message !== undefined && (
              <p className="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">
                {message}
              </p>
            )}
            {failures.length > 0 && (
              <p className="text-muted-foreground font-mono text-xs">
                {failures.map((failure) => failure.kind).join(', ')}
              </p>
            )}
          </div>
        </CollapsibleDetails>
      )}
    </div>
  );
}
