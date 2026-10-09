'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { RadioGroup, type RadioGroupOption } from '@tale/ui/radio-group';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import type {
  ReplayPlan,
  ReplayStarted,
} from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { useReplayRun } from '../hooks/mutations';
import { useReplayPlan } from '../hooks/queries';
import { shortRunId } from '../lib/run-view';

type VersionChoice = 'same' | 'latest' | 'deployed';

export interface RunReplayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  run: { id: string; version: number; mode: 'mock' | 'live' };
  /** The step to run again from. */
  from: string;
  /** How a reader names a step. */
  stepLabel: (nodeId: string) => string;
  /** The run failed at this step: the dialog retries it. */
  failedHere: boolean;
  latestVersion?: number;
  deployedVersion?: number;
  /** The reader may start live runs. */
  canStartLive: boolean;
  onStarted: (started: ReplayStarted) => void;
  /** Show a step the plan names, closing the dialog. */
  onSelectStep?: (nodeId: string) => void;
}

/**
 * Retry a run from one of its steps: what the new run reuses and what it
 * runs again, the writes that go out a second time, and on which version
 * and in which mode — read from the server's plan before anything starts.
 */
export function RunReplayDialog({
  open,
  onOpenChange,
  organizationId,
  run,
  from,
  stepLabel,
  failedHere,
  latestVersion,
  deployedVersion,
  canStartLive,
  onStarted,
  onSelectStep,
}: RunReplayDialogProps) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const [version, setVersion] = useState<VersionChoice>('same');
  const [mode, setMode] = useState<'mock' | 'live'>(run.mode);
  const [requestId] = useState(() => crypto.randomUUID());
  const versionId = useId();
  const modeId = useId();
  const step = stepLabel(from);

  const plan = useReplayPlan(organizationId, open ? run.id : undefined, {
    kind: 'from',
    from,
    version,
    mode,
  });
  const replay = useReplayRun();

  const targetOf = (choice: VersionChoice): number | undefined =>
    choice === 'same'
      ? run.version
      : choice === 'latest'
        ? latestVersion
        : deployedVersion;

  const versionOptions = useMemo((): RadioGroupOption[] => {
    const options: RadioGroupOption[] = [
      {
        value: 'same',
        label: t('replay.version.same', { version: String(run.version) }),
      },
    ];
    if (latestVersion !== undefined && latestVersion !== run.version) {
      options.push({
        value: 'latest',
        label: t('replay.version.latest', {
          version: String(latestVersion),
        }),
      });
    }
    if (
      deployedVersion !== undefined &&
      deployedVersion !== run.version &&
      deployedVersion !== latestVersion
    ) {
      options.push({
        value: 'deployed',
        label: t('replay.version.deployed', {
          version: String(deployedVersion),
        }),
      });
    }
    return options;
  }, [deployedVersion, latestVersion, run.version, t]);

  const listOf = (labels: string[]): string =>
    new Intl.ListFormat(locale, { type: 'conjunction' }).format(labels);

  const data: ReplayPlan | null | undefined = plan.data;
  const liveReason = !canStartLive
    ? t('replay.mode.liveNeedsRole')
    : data !== undefined && data !== null && !data.deployed
      ? t('replay.mode.liveNeedsDeployed')
      : undefined;
  // A fork of a mock run stays mock: its results were made up.
  const mockOnly = run.mode === 'mock';
  const modeOptions: RadioGroupOption[] = [
    { value: 'mock', label: t('replay.mode.mock') },
    {
      value: 'live',
      label: t('replay.mode.live'),
      disabled: mockOnly || liveReason !== undefined,
      ...(mockOnly
        ? { description: t('replay.mode.mockStaysMock') }
        : liveReason !== undefined
          ? { description: liveReason }
          : {}),
    },
  ];

  const refusal = data?.refusal;
  const reused = data?.reuse.map((entry) => entry.nodeId) ?? [from];
  const rerun = data?.rerun.map((entry) => entry.nodeId) ?? [from];
  const writesLive = mode === 'live' && (data?.writesAgain ?? 0) > 0;
  const confirmLabel = failedHere
    ? t('replay.from.confirmRetry', { step })
    : t('replay.from.confirm', { step });

  const start = (): void => {
    replay.mutate(
      {
        organizationId,
        runId: run.id,
        kind: 'from',
        from,
        version: version === 'same' ? 'same' : (targetOf(version) ?? 'same'),
        mode,
        requestId,
      },
      {
        onSuccess: (started) => {
          onOpenChange(false);
          onStarted(started);
        },
      },
    );
  };

  const stepList = (ids: readonly string[], icon: 'reuse' | 'rerun') => (
    <ul className="flex flex-col gap-1 text-sm">
      {ids.map((id) => (
        <li key={id} className="flex items-center gap-2">
          {icon === 'reuse' ? (
            <RotateCcw
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <RefreshCw
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
          )}
          {onSelectStep === undefined ? (
            <SkeletonBox className="truncate">{stepLabel(id)}</SkeletonBox>
          ) : (
            <SkeletonBox asChild>
              <button
                type="button"
                className="focus-visible:ring-ring truncate rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => {
                  onOpenChange(false);
                  onSelectStep(id);
                }}
              >
                {stepLabel(id)}
              </button>
            </SkeletonBox>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex flex-col gap-4">
        <ResponsiveDialogTitle>
          {failedHere
            ? t('replay.from.titleRetry', { step })
            : t('replay.from.title', { step })}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('replay.from.body', {
            version: String(targetOf(version) ?? run.version),
            run: shortRunId(run.id),
            step,
          })}
        </ResponsiveDialogDescription>

        {plan.isError || data === null ? (
          <Alert
            variant="destructive"
            title={t('replay.loadFailed')}
            description={
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  void plan.refetch();
                }}
              >
                {t('replay.tryAgain')}
              </Button>
            }
          />
        ) : refusal !== undefined ? (
          <Alert
            variant="destructive"
            live="polite"
            title={t(`replay.refusal.${refusal.code}.title`)}
            description={t(`replay.refusal.${refusal.code}.body`, {
              nodes: listOf((refusal.nodes ?? []).map(stepLabel)),
              step,
            })}
          />
        ) : (
          // While the plan loads, the step it starts from stands in for both
          // lists, masked, so the dialog keeps its size as the plan lands.
          <Skeletonize loading={plan.isPending} label={t('replay.loading')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <section
                aria-labelledby={`${versionId}-reused`}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <SkeletonBox>
                  <Text
                    as="h3"
                    id={`${versionId}-reused`}
                    className="text-sm font-medium"
                  >
                    {t('replay.from.reused', { count: reused.length })}
                  </Text>
                </SkeletonBox>
                {reused.length === 0 ? (
                  <Text className="text-muted-foreground text-sm">
                    {t('replay.from.nothingReused')}
                  </Text>
                ) : (
                  stepList(reused, 'reuse')
                )}
              </section>
              <section
                aria-labelledby={`${versionId}-rerun`}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <SkeletonBox>
                  <Text
                    as="h3"
                    id={`${versionId}-rerun`}
                    className="text-sm font-medium"
                  >
                    {t('replay.from.rerun', { count: rerun.length })}
                  </Text>
                </SkeletonBox>
                {stepList(rerun, 'rerun')}
              </section>
            </div>
          </Skeletonize>
        )}
        {data !== null &&
          data !== undefined &&
          refusal === undefined &&
          data.writesAgain > 0 && (
            <Alert
              variant={writesLive ? 'warning' : 'default'}
              live="off"
              description={
                writesLive
                  ? t('replay.writes.live', {
                      count: data.writesAgain,
                      list: listOf(
                        data.rerun
                          .filter((entry) => entry.effect === 'write')
                          .map((entry) => stepLabel(entry.nodeId)),
                      ),
                    })
                  : t('replay.writes.mock')
              }
            />
          )}

        {versionOptions.length > 1 && (
          <RadioGroup
            label={t('replay.version.label')}
            value={version}
            onValueChange={(value) => {
              if (
                value === 'same' ||
                value === 'latest' ||
                value === 'deployed'
              ) {
                setVersion(value);
              }
            }}
            options={versionOptions}
          />
        )}
        <RadioGroup
          id={modeId}
          label={t('replay.mode.label')}
          value={mode}
          onValueChange={(value) => {
            if (value === 'mock' || value === 'live') setMode(value);
          }}
          options={modeOptions}
        />

        {replay.isError && (
          <Alert
            variant="destructive"
            live="polite"
            description={t('replay.refused', {
              detail: failureDetail(replay.error) ?? '',
            })}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            autoFocus={writesLive}
            onClick={() => onOpenChange(false)}
          >
            {t('replay.cancel')}
          </Button>
          <Button
            autoFocus={!writesLive}
            disabled={
              plan.isPending ||
              data === null ||
              data === undefined ||
              refusal !== undefined ||
              replay.isPending
            }
            onClick={start}
          >
            {confirmLabel}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
