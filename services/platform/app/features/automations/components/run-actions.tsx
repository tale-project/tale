'use client';

import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { useCopy } from '@tale/ui/use-copy';
import { toast } from '@tale/ui/use-toast';
import { Copy, EllipsisVertical, Link2, RotateCw } from 'lucide-react';
import { useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReplayStarted } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { useReplayRun } from '../hooks/mutations';

/** One way to run a run again: on which version, in which mode. */
interface AgainChoice {
  version: 'same' | 'latest' | 'deployed';
  mode: 'mock' | 'live';
}

export interface RunActionsProps {
  organizationId: string;
  run: { id: string; version: number; mode: 'mock' | 'live' };
  latestVersion?: number;
  /** The version that runs live now, if any. */
  deployedVersion?: number;
  /** The reader may start live runs. */
  canStartLive: boolean;
  /** The writes the run made, and the services they went to: what running
   * it again live sends again. */
  writes: { count: number; connectors: readonly string[] };
  /** The run's page address, for Copy link. */
  href: string;
  onStarted: (started: ReplayStarted) => void;
}

/**
 * The ways to run a run again from its page: as it ran (same version,
 * mode and input), as a test on the latest version, live on the version
 * that runs live now — asking first when running live sends writes again —
 * and its ID and link to copy.
 */
export function RunActions({
  organizationId,
  run,
  latestVersion,
  deployedVersion,
  canStartLive,
  writes,
  href,
  onStarted,
}: RunActionsProps) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const { copy } = useCopy();
  const replay = useReplayRun();
  // One nonce per choice confirmed: a repeated click starts one run.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState<AgainChoice | null>(null);

  const live = run.mode === 'live';
  const versionLive = deployedVersion === run.version;
  const sameReason = !live
    ? undefined
    : !canStartLive
      ? t('replay.mode.liveNeedsRole')
      : !versionLive
        ? deployedVersion === undefined
          ? t('again.noneLive', { version: String(run.version) })
          : t('again.notLive', {
              version: String(run.version),
              live: String(deployedVersion),
            })
        : undefined;

  const start = (choice: AgainChoice): void => {
    replay.mutate(
      {
        organizationId,
        runId: run.id,
        kind: 'again',
        version: choice.version,
        mode: choice.mode,
        requestId,
      },
      {
        onSuccess: (started) => {
          setRequestId(crypto.randomUUID());
          onStarted(started);
        },
        onError: (error) => {
          setRequestId(crypto.randomUUID());
          toast({
            title: t('again.refused', { detail: failureDetail(error) ?? '' }),
            variant: 'destructive',
          });
        },
      },
    );
  };

  /** A live run that sends writes asks first; anything else starts. */
  const choose = (choice: AgainChoice): void => {
    if (choice.mode === 'live' && writes.count > 0) setConfirming(choice);
    else start(choice);
  };

  const items = [
    ...(latestVersion !== undefined && latestVersion !== run.version
      ? [
          {
            type: 'item' as const,
            label: t('again.latest', { version: String(latestVersion) }),
            onClick: () => choose({ version: 'latest', mode: 'mock' }),
          },
        ]
      : []),
    ...(live
      ? [
          {
            type: 'item' as const,
            label: t('again.asTest'),
            onClick: () => choose({ version: 'same', mode: 'mock' }),
          },
        ]
      : []),
    ...(live &&
    canStartLive &&
    deployedVersion !== undefined &&
    deployedVersion !== run.version
      ? [
          {
            type: 'item' as const,
            label: t('again.live', { version: String(deployedVersion) }),
            onClick: () => choose({ version: 'deployed', mode: 'live' }),
          },
        ]
      : []),
  ];
  const copyItems = [
    {
      type: 'item' as const,
      label: t('again.copyId'),
      icon: Copy,
      onClick: () => {
        void copy(run.id).then((copied) => {
          if (copied) toast({ title: t('again.idCopied') });
        });
      },
    },
    {
      type: 'item' as const,
      label: t('again.copyLink'),
      icon: Link2,
      onClick: () => {
        void copy(`${window.location.origin}${href}`).then((copied) => {
          if (copied) toast({ title: t('again.linkCopied') });
        });
      },
    },
  ];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="sm"
        icon={RotateCw}
        isLoading={replay.isPending}
        {...(sameReason !== undefined && {
          disabled: true,
          disabledReason: sameReason,
        })}
        onClick={() => choose({ version: 'same', mode: run.mode })}
      >
        {t('again.button')}
      </Button>
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            variant="ghost"
            aria-label={t('again.menu')}
          />
        }
        items={items.length > 0 ? [items, copyItems] : [copyItems]}
      />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t('again.liveConfirm.title')}
        description={t('again.liveConfirm.body', {
          count: writes.count,
          connectors: new Intl.ListFormat(locale, {
            type: 'conjunction',
          }).format(writes.connectors),
        })}
        confirmText={t('again.liveConfirm.confirm')}
        variant="warning"
        isLoading={replay.isPending}
        onConfirm={() => {
          const choice = confirming;
          setConfirming(null);
          if (choice !== null) start(choice);
        }}
      />
    </div>
  );
}
