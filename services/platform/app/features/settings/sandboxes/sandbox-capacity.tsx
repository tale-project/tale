import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Grid, Row } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { RefreshCw } from 'lucide-react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import type { SandboxCapacity } from '@/app/lib/backend/contract/sandbox';
import { useT } from '@/lib/i18n/client';

interface SandboxCapacitySectionProps {
  capacity?: SandboxCapacity;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/** Admission slots and measured resources are separate, explicitly named metrics. */
export function SandboxCapacitySection({
  capacity,
  isLoading,
  isRefreshing,
  onRefresh,
}: SandboxCapacitySectionProps) {
  const { t } = useT('sandboxes');
  const { formatDate } = useFormatDate();
  const { formatNumber } = useFormatNumber();
  const snapshot = capacity?.status === 'available' ? capacity : undefined;
  const unknown = t('capacity.unknownValue');
  const number = (value: number | null | undefined) =>
    value == null ? unknown : formatNumber(value, { maximumFractionDigits: 1 });
  const gib = (value: number | null | undefined) =>
    value == null ? unknown : number(value / 1024 ** 3);
  const slots = snapshot?.sessions;
  const metrics = [
    {
      label: t(
        snapshot?.scope === 'namespace'
          ? 'capacity.namespaceSessions'
          : 'capacity.hostSessions',
      ),
      value: slots
        ? t('capacity.slots', {
            used: slots.running + slots.starting,
            limit: slots.limit,
          })
        : unknown,
      hint: slots
        ? t('capacity.sessionStates', {
            running: slots.running,
            starting: slots.starting,
          })
        : t('capacity.sessionSlotsHint'),
    },
    {
      label: t('capacity.organizationSessions'),
      value: slots
        ? t('capacity.slots', {
            used: slots.organizationRunning + slots.organizationStarting,
            limit: slots.organizationLimit,
          })
        : unknown,
      hint: slots
        ? t('capacity.sessionStates', {
            running: slots.organizationRunning,
            starting: slots.organizationStarting,
          })
        : t('capacity.organizationSessionsHint'),
    },
    {
      label: t('capacity.cpu'),
      value:
        snapshot &&
        (snapshot.resources.cpu.usedCores !== null ||
          snapshot.resources.cpu.totalCores !== null)
          ? t('capacity.cpuUsage', {
              used: number(snapshot.resources.cpu.usedCores),
              total: number(snapshot.resources.cpu.totalCores),
            })
          : unknown,
      hint: t('capacity.cpuHint'),
    },
    {
      label: t('capacity.memory'),
      value:
        snapshot &&
        (snapshot.resources.memory.usedBytes !== null ||
          snapshot.resources.memory.totalBytes !== null)
          ? t('capacity.memoryUsage', {
              used: gib(snapshot.resources.memory.usedBytes),
              total: gib(snapshot.resources.memory.totalBytes),
            })
          : unknown,
      hint: t('capacity.memoryHint'),
    },
  ];

  return (
    <Skeletonize loading={isLoading} label={t('capacity.title')}>
      <SettingsSection
        title={t('capacity.title')}
        description={t('capacity.description')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {t('capacity.refresh')}
          </Button>
        }
      >
        <Grid cols={1} sm={2} gap={3}>
          {metrics.map((metric) => (
            <Card key={metric.label} padding="md">
              <dl className="flex flex-col gap-2">
                <dt className="text-muted-foreground text-sm">
                  {metric.label}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  <SkeletonBox>{metric.value}</SkeletonBox>
                </dd>
                <dd className="text-muted-foreground text-xs">{metric.hint}</dd>
              </dl>
            </Card>
          ))}
        </Grid>
        <p className="text-muted-foreground text-sm">
          {t('capacity.operatorLimits')}
        </p>
        {snapshot ? (
          <Row gap={2} wrap className="text-muted-foreground text-xs">
            <span>{t(`capacity.scopes.${snapshot.scope}`)}</span>
            <time dateTime={new Date(snapshot.observedAt).toISOString()}>
              {t('capacity.observedAt', {
                time: formatDate(new Date(snapshot.observedAt), 'long'),
              })}
            </time>
          </Row>
        ) : !isLoading ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t(
              capacity?.status === 'unavailable' &&
                capacity.reason === 'not_configured'
                ? 'capacity.notConfigured'
                : 'capacity.unreachable',
            )}
          </p>
        ) : null}
      </SettingsSection>
    </Skeletonize>
  );
}
