'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { ErrorDisplayCompact } from '@tale/ui/error-boundaries/error-display-compact';
import { SKELETON_PULSE } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { CircleDashed, Loader2, Radio, Rocket, Undo2 } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useAutomationLiveDeployment } from '../../hooks/queries';
import type { DeployVersion } from '../../hooks/use-deploy-version';
import { VersionAuthor } from './version-author';

/**
 * What is live: the version, since when, who put it live and through what,
 * and how many of its runs are still going (they finish on it whatever goes
 * live next). An author can put back the version it replaced in one click —
 * **Roll back to vN** — or, while nothing is live, deploy the latest. The
 * deploy names the live version the card shows, so a deploy someone made
 * meanwhile is never undone unseen.
 */
export function LiveVersionCard({
  organizationId,
  automationSlug,
  canAuthor,
  latestVersion,
  deployer,
}: {
  organizationId: string;
  automationSlug: string;
  /** May deploy and roll back (an owner, admin or developer). */
  canAuthor: boolean;
  /** The newest version, which a first deploy offers. */
  latestVersion: number | undefined;
  deployer: Pick<DeployVersion, 'deploy' | 'pendingVersion'>;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const query = useAutomationLiveDeployment(organizationId, automationSlug);

  if (query.isPending) {
    return (
      <Card padding="md" aria-busy="true" data-testid="live-version-card">
        <span
          aria-hidden="true"
          className={cn(SKELETON_PULSE, 'block h-5 w-40 rounded')}
        />
        <span
          aria-hidden="true"
          className={cn(SKELETON_PULSE, 'mt-2 block h-4 w-64 rounded')}
        />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <div role="alert">
        <ErrorDisplayCompact
          error={query.error}
          organizationId={organizationId}
          reset={() => void query.refetch()}
        />
      </div>
    );
  }

  const live = query.data.live;
  const busy = deployer.pendingVersion !== null;
  const actionButton = (target: number, label: string, icon: typeof Rocket) => {
    const pending = deployer.pendingVersion === target;
    return (
      <Button
        variant="secondary"
        size="sm"
        // Busy, not disabled: a disabled button drops its focus, which stays
        // on the button while the toast says what happened.
        icon={pending ? Loader2 : icon}
        iconClassName={
          pending ? 'animate-spin motion-reduce:animate-none' : undefined
        }
        aria-busy={pending || undefined}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return;
          deployer.deploy(target, live?.version ?? null);
        }}
        className="w-full shrink-0 sm:w-auto"
      >
        {label}
      </Button>
    );
  };

  if (live === null) {
    return (
      <Card
        padding="md"
        data-testid="live-version-card"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <CircleDashed
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
          />
          <Text>{t('deployments.none')}</Text>
        </div>
        {canAuthor &&
          latestVersion !== undefined &&
          actionButton(
            latestVersion,
            t('detail.deployVersion', { version: latestVersion }),
            Rocket,
          )}
      </Card>
    );
  }

  // The deploy that put the live version there says what it replaced.
  const newest = query.data.deployments[0];
  const replaced =
    newest !== undefined && newest.version === live.version
      ? newest.previousVersion
      : null;

  return (
    <Card
      padding="md"
      data-testid="live-version-card"
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Radio
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-green-800 dark:text-green-300"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">
            {t('deployments.live.title', { version: live.version })}
          </h3>
          <Text variant="muted" className="flex flex-wrap gap-x-1">
            <span>
              {t('deployments.live.since', {
                date: formatDate(new Date(live.deployedAt), 'long'),
              })}
            </span>
            <span aria-hidden="true">·</span>
            <VersionAuthor
              organizationId={organizationId}
              layout="inline"
              facts={{
                actor: live.deployedBy,
                via: live.via,
                clientName: live.clientName,
              }}
            />
          </Text>
          <Text variant="muted">
            {t('deployments.live.activeRuns', {
              count: live.activeRuns,
              version: live.version,
            })}
          </Text>
        </div>
      </div>
      {canAuthor &&
        replaced !== null &&
        actionButton(
          replaced,
          replaced < live.version
            ? t('deploy.rollBack', { version: replaced })
            : t('detail.deployVersion', { version: replaced }),
          replaced < live.version ? Undo2 : Rocket,
        )}
    </Card>
  );
}
