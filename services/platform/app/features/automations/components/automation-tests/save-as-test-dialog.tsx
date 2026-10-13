'use client';

import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { formatBytes } from '@tale/ui/format';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Input } from '@tale/ui/input';
import { RadioGroup } from '@tale/ui/radio-group';
import { Text } from '@tale/ui/text';
import { useMemo, useState } from 'react';

import {
  defaultExpect,
  expectChoices,
  simulationCandidates,
  testFromRun,
  type RunForTest,
  type SimulationCandidate,
  type TestFromRunExpect,
} from '@/lib/automations/tests/test-from-run';
import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import type { TestFromRunWarning } from '@/lib/shared/schemas/automation-tests';

import { nodeTitle } from '../../lib/node-face';
import { TestDataNotice } from './test-data-notice';

export interface SaveAsTestDialogProps {
  run: RunForTest;
  /** The version the run used, when it was a saved one. */
  runVersion?: number;
  /** The document the test joins: the draft, or the version on screen. */
  document: Pick<Automation, 'nodes' | 'tests'>;
  /** The version the draft is of. */
  version?: number;
  onClose: () => void;
  /** Adds the test to the draft. */
  onAdd: (test: Record<string, unknown>) => void;
}

const EXPECT_KEYS = {
  equals: 'tests.fromRun.expect.equals',
  includes: 'tests.fromRun.expect.includes',
  succeeds: 'tests.fromRun.expect.succeeds',
  'fails-here': 'tests.fromRun.expect.failsHere',
  none: 'tests.fromRun.expect.none',
} as const;

/**
 * A run saved as a test: its name, what it expects of the run (by how the
 * run ended), which steps answer in the test as they did in the run, and
 * whether it expects the same actions — with what the author should know
 * before it joins the draft: values withheld as secrets, calls of a live
 * run that answer otherwise in a test, and parts too large to keep well.
 */
export function SaveAsTestDialog({
  run,
  runVersion,
  document,
  version,
  onClose,
  onAdd,
}: SaveAsTestDialogProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const choices = useMemo(() => expectChoices(run, document), [run, document]);
  const candidates = useMemo(
    () => simulationCandidates(run, document),
    [run, document],
  );
  const [name, setName] = useState(() =>
    t('tests.fromRun.defaultName', {
      when: new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(run.startedAt),
    }),
  );
  const [expect, setExpect] = useState<TestFromRunExpect>(() =>
    defaultExpect(run, document),
  );
  const [simulate, setSimulate] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        candidates
          .filter((candidate) => candidate.defaultOn)
          .map((candidate) => candidate.node),
      ),
  );
  const [expectActions, setExpectActions] = useState(false);
  const made = useMemo(
    () =>
      testFromRun({
        run,
        document,
        options: {
          ...(name.trim() !== '' && { name: name.trim() }),
          expect,
          simulate: [...simulate],
          expectActions,
        },
      }),
    [run, document, name, expect, simulate, expectActions],
  );
  const failedAt = run.error?.nodeId;

  const reasonOf = (candidate: SimulationCandidate): string => {
    switch (candidate.disabledReason) {
      case 'transform':
        return t('tests.fromRun.simulate.code');
      case 'too_large':
        return t('tests.fromRun.simulate.tooLarge', {
          size: formatBytes(candidate.bytes, locale),
        });
      case 'not_in_document':
        return t('tests.fromRun.simulate.notInDocument');
      default:
        return candidate.standIn === 'failure'
          ? t('tests.fromRun.simulate.failure')
          : t('tests.fromRun.simulate.output');
    }
  };
  const warningOf = (warning: TestFromRunWarning): string => {
    if (warning.kind === 'redacted') {
      return t('tests.fromRun.warnings.redacted', { count: warning.total });
    }
    if (warning.kind === 'live-run-needs-stand-ins') {
      return t('tests.fromRun.warnings.liveRun', {
        nodes: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
          warning.nodes.map(nodeTitle),
        ),
      });
    }
    return t('tests.fromRun.warnings.tooLarge', {
      part: warning.part,
      size: formatBytes(warning.bytes, locale),
    });
  };
  const expectOptions = choices.map((choice) => {
    const option: { value: string; label: string; description?: string } = {
      value: choice,
      label:
        choice === 'fails-here'
          ? t(EXPECT_KEYS[choice], { node: nodeTitle(failedAt ?? '') })
          : t(EXPECT_KEYS[choice]),
    };
    // A run that failed: success is what a fix should bring.
    if (choice === 'succeeds' && failedAt !== undefined) {
      option.description = t('tests.fromRun.expect.succeedsHelp');
    }
    return option;
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={onClose}
      title={t('tests.fromRun.title')}
      description={t('tests.fromRun.description')}
      confirmText={t('tests.fromRun.confirm')}
      disableConfirm={name.trim() === ''}
      onConfirm={() => onAdd({ ...made.test })}
    >
      <div className="flex flex-col gap-4">
        <Input
          label={t('tests.fields.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <RadioGroup
          label={t('tests.fromRun.expect.label')}
          value={expect}
          onValueChange={(next) => {
            const chosen = choices.find((choice) => choice === next);
            if (chosen !== undefined) setExpect(chosen);
          }}
          options={expectOptions}
        />
        {candidates.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-foreground mb-1 text-sm font-medium">
              {t('tests.fromRun.simulate.label')}
            </legend>
            {candidates.map((candidate) => (
              <Checkbox
                key={candidate.node}
                label={nodeTitle(candidate.node)}
                description={reasonOf(candidate)}
                checked={simulate.has(candidate.node)}
                disabled={candidate.disabledReason !== undefined}
                onCheckedChange={(checked) => {
                  const next = new Set(simulate);
                  if (checked === true) next.add(candidate.node);
                  else next.delete(candidate.node);
                  setSimulate(next);
                }}
              />
            ))}
          </fieldset>
        )}
        <Checkbox
          label={t('tests.fromRun.actions')}
          description={t('tests.fromRun.actionsHelp')}
          checked={expectActions}
          onCheckedChange={(checked) => setExpectActions(checked === true)}
        />
        {(made.warnings.length > 0 || made.dropped.length > 0) && (
          <Alert
            variant="warning"
            description={
              <ul className="flex flex-col gap-1">
                {made.warnings.map((warning) => (
                  <li key={warning.kind}>{warningOf(warning)}</li>
                ))}
                {made.dropped.length > 0 && (
                  <li>
                    {t('tests.fromRun.warnings.dropped', {
                      nodes: new Intl.ListFormat(locale, {
                        type: 'conjunction',
                      }).format(
                        made.dropped.map((each) => nodeTitle(each.node)),
                      ),
                    })}
                  </li>
                )}
              </ul>
            }
          />
        )}
        <Text as="p" variant="muted" className="text-sm">
          {runVersion !== undefined &&
          version !== undefined &&
          runVersion !== version
            ? t('tests.fromRun.targetOtherVersion', {
                run: runVersion,
                version,
              })
            : t('tests.fromRun.target')}
        </Text>
        <TestDataNotice />
      </div>
    </ConfirmDialog>
  );
}
