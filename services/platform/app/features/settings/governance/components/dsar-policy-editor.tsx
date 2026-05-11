'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { AlertTriangle, Ban, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { DsarGovernanceConfig } from '@/lib/shared/schemas/governance';

import {
  useCancelPendingDsarPolicyChange,
  useProposeDsarPolicy,
} from '../hooks/mutations';
import { useDsarPolicyForUi } from '../hooks/queries';

interface DsarPolicyEditorProps {
  organizationId: string;
}

/**
 * Auto-save on blur, with two safeguards above the prior commit:
 *
 *   1. WRITES are owner-only (server enforces; UI surfaces a "Owner
 *      only" hint and disables inputs for admins).
 *   2. WEAKENING changes (shorter cooling-off, disabling dual approval,
 *      higher daily limit) are routed through a 24h pending window.
 *      During the window the editor shows a banner with the proposer,
 *      effective time, and a Cancel button any admin (not just owner)
 *      can use. Tightening changes apply immediately.
 *
 * Notifications fan out on propose / apply / cancel / tighten so other
 * admins can react before a weakened policy takes effect.
 */
export function DsarPolicyEditor({ organizationId }: DsarPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();

  const { data, isLoading } = useDsarPolicyForUi(organizationId);
  const proposeMutation = useProposeDsarPolicy();
  const cancelMutation = useCancelPendingDsarPolicyChange();

  // Local draft state for the two number inputs so mid-typing values
  // don't snap on every reactive re-render. The Switch binds directly
  // to `data.config.requireDualApproval` — no local copy, so it always
  // reflects the canonical effective value (a staged loosening shows
  // up in the pending banner, not by visually flipping the toggle).
  const [coolingOffHours, setCoolingOffHours] = useState('');
  const [dailyLimitPerAdmin, setDailyLimitPerAdmin] = useState('');

  // Resync drafts whenever Convex pushes a new effective config
  // (initial load, cancel-pending, apply-pending, external admin
  // change). Without this the form would stay frozen on its
  // first-loaded values.
  const effectiveCoolingOffHours = data?.config.coolingOffHours;
  const effectiveDailyLimit = data?.config.dailyLimitPerAdmin;
  useEffect(() => {
    if (effectiveCoolingOffHours !== undefined) {
      setCoolingOffHours(String(effectiveCoolingOffHours));
    }
    if (effectiveDailyLimit !== undefined) {
      setDailyLimitPerAdmin(String(effectiveDailyLimit));
    }
  }, [effectiveCoolingOffHours, effectiveDailyLimit]);

  const persist = useCallback(
    async (next: DsarGovernanceConfig) => {
      try {
        const result = await proposeMutation.mutateAsync({
          organizationId,
          config: next,
        });
        if (result.applied) {
          toast({
            title: t('toastSavedTitle'),
            description: t('dsarPolicy.saved'),
            variant: 'success',
          });
        } else {
          toast({
            title: t('dsarPolicy.loosenProposedTitle'),
            description: t('dsarPolicy.loosenProposedDescription'),
            variant: 'success',
          });
        }
      } catch (e) {
        console.error(e);
        toast({
          title: t('toastSaveFailedTitle'),
          description: t('dsarPolicy.saveFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, proposeMutation, toast, t],
  );

  const commitCoolingOffHours = useCallback(() => {
    if (!data) return;
    const hours = Number(coolingOffHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 72) {
      toast({
        title: t('dsarPolicy.invalidCoolingOffHours'),
        variant: 'destructive',
      });
      setCoolingOffHours(String(data.config.coolingOffHours));
      return;
    }
    if (hours === data.config.coolingOffHours) return;
    void persist({
      coolingOffHours: hours,
      requireDualApproval: data.config.requireDualApproval,
      dailyLimitPerAdmin: data.config.dailyLimitPerAdmin,
    });
  }, [coolingOffHours, data, persist, toast, t]);

  const commitDailyLimit = useCallback(() => {
    if (!data) return;
    const limit = Number(dailyLimitPerAdmin);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      toast({
        title: t('dsarPolicy.invalidDailyLimit'),
        variant: 'destructive',
      });
      setDailyLimitPerAdmin(String(data.config.dailyLimitPerAdmin));
      return;
    }
    if (limit === data.config.dailyLimitPerAdmin) return;
    void persist({
      coolingOffHours: data.config.coolingOffHours,
      requireDualApproval: data.config.requireDualApproval,
      dailyLimitPerAdmin: limit,
    });
  }, [dailyLimitPerAdmin, data, persist, toast, t]);

  const handleDualApprovalToggle = useCallback(
    (next: boolean) => {
      if (!data) return;
      void persist({
        coolingOffHours: data.config.coolingOffHours,
        requireDualApproval: next,
        dailyLimitPerAdmin: data.config.dailyLimitPerAdmin,
      });
    },
    [data, persist],
  );

  const handleCancelPending = useCallback(async () => {
    try {
      await cancelMutation.mutateAsync({ organizationId });
      toast({
        title: t('dsarPolicy.loosenCancelledTitle'),
        variant: 'success',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: t('toastSaveFailedTitle'),
        variant: 'destructive',
      });
    }
  }, [cancelMutation, organizationId, toast, t]);

  if (isLoading || !data) {
    return (
      <PageSection
        title={t('dsarPolicy.title')}
        description={t('dsarPolicy.description')}
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </PageSection>
    );
  }

  // While a pending weakening is staged, lock every input — the
  // backend refuses any new propose with `pendingChangeExists`, so a
  // user clicking should never reach a write. The visible disabled
  // styling makes that explicit.
  const hasPending = data.pending !== null;
  const readOnly =
    !data.callerIsOwner ||
    hasPending ||
    proposeMutation.isPending ||
    cancelMutation.isPending;
  const pendingFields = {
    coolingOffHours:
      data.pending !== null &&
      data.pending.config.coolingOffHours !== data.config.coolingOffHours,
    requireDualApproval:
      data.pending !== null &&
      data.pending.config.requireDualApproval !==
        data.config.requireDualApproval,
    dailyLimitPerAdmin:
      data.pending !== null &&
      data.pending.config.dailyLimitPerAdmin !== data.config.dailyLimitPerAdmin,
  };

  return (
    <PageSection
      title={t('dsarPolicy.title')}
      description={t('dsarPolicy.description')}
    >
      <div className="flex max-w-2xl flex-col gap-5">
        {!data.callerIsOwner && (
          <div
            role="status"
            className="border-border bg-muted/30 flex items-start gap-2 rounded-md border p-3 text-sm"
          >
            <Lock
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <Text as="span" variant="muted" className="text-xs">
              {t('dsarPolicy.ownerOnlyNotice')}
            </Text>
          </div>
        )}

        {data.pending && (
          <PendingChangeBanner
            current={data.config}
            pending={data.pending}
            onCancel={() => void handleCancelPending()}
            cancelDisabled={cancelMutation.isPending}
          />
        )}

        <PendingFieldWrap pending={pendingFields.coolingOffHours} t={t}>
          <Input
            id="dsar-policy-cooling-off"
            type="number"
            min={0}
            max={72}
            step={1}
            label={t('dsarPolicy.coolingOffHours.label')}
            description={t('dsarPolicy.coolingOffHours.description')}
            value={coolingOffHours}
            onChange={(e) => setCoolingOffHours(e.target.value)}
            onBlur={commitCoolingOffHours}
            disabled={readOnly}
          />
        </PendingFieldWrap>

        <PendingFieldWrap pending={pendingFields.requireDualApproval} t={t}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <Text as="span" className="text-sm font-medium">
                {t('dsarPolicy.requireDualApproval.label')}
              </Text>
              <Text as="span" variant="muted" className="text-xs">
                {t('dsarPolicy.requireDualApproval.description')}
              </Text>
            </div>
            <Switch
              checked={data.config.requireDualApproval}
              onCheckedChange={handleDualApprovalToggle}
              disabled={readOnly}
              aria-label={t('dsarPolicy.requireDualApproval.label')}
            />
          </div>
        </PendingFieldWrap>

        <PendingFieldWrap pending={pendingFields.dailyLimitPerAdmin} t={t}>
          <Input
            id="dsar-policy-daily-limit"
            type="number"
            min={1}
            max={50}
            step={1}
            label={t('dsarPolicy.dailyLimitPerAdmin.label')}
            description={t('dsarPolicy.dailyLimitPerAdmin.description')}
            value={dailyLimitPerAdmin}
            onChange={(e) => setDailyLimitPerAdmin(e.target.value)}
            onBlur={commitDailyLimit}
            disabled={readOnly}
          />
        </PendingFieldWrap>
      </div>
    </PageSection>
  );
}

/**
 * Visual wrapper that dims a field and overlays a "locked" hint
 * during the loosen-grace window. Subtle so the canonical value is
 * still readable, but unmistakably non-interactive.
 */
function PendingFieldWrap({
  pending,
  t,
  children,
}: {
  pending: boolean;
  t: ReturnType<typeof useT>['t'];
  children: React.ReactNode;
}) {
  if (!pending) return <>{children}</>;
  return (
    <div className="relative opacity-60">
      <div className="pointer-events-none">{children}</div>
      <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
        <Lock className="size-3" aria-hidden="true" />
        <span>{t('dsarPolicy.pendingFieldLocked')}</span>
      </div>
    </div>
  );
}

function PendingChangeBanner({
  current,
  pending,
  onCancel,
  cancelDisabled,
}: {
  current: DsarGovernanceConfig;
  pending: {
    config: DsarGovernanceConfig;
    effectiveAt: number;
    proposedBy: string;
    proposedByEmail?: string;
    proposedByName?: string;
    proposedAt: number;
  };
  onCancel: () => void;
  cancelDisabled: boolean;
}) {
  const { t } = useT('governance');
  const diffs: { label: string; from: string; to: string }[] = [];
  if (pending.config.coolingOffHours !== current.coolingOffHours) {
    diffs.push({
      label: t('dsarPolicy.coolingOffHours.label'),
      from: String(current.coolingOffHours),
      to: String(pending.config.coolingOffHours),
    });
  }
  if (pending.config.requireDualApproval !== current.requireDualApproval) {
    diffs.push({
      label: t('dsarPolicy.requireDualApproval.label'),
      from: String(current.requireDualApproval),
      to: String(pending.config.requireDualApproval),
    });
  }
  if (pending.config.dailyLimitPerAdmin !== current.dailyLimitPerAdmin) {
    diffs.push({
      label: t('dsarPolicy.dailyLimitPerAdmin.label'),
      from: String(current.dailyLimitPerAdmin),
      to: String(pending.config.dailyLimitPerAdmin),
    });
  }
  return (
    <div
      role="status"
      className="text-foreground flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <Text as="span" className="font-medium">
            {t('dsarPolicy.pendingBanner.title')}
          </Text>
          <Text as="span" variant="muted" className="text-xs">
            {t('dsarPolicy.pendingBanner.description', {
              name: pending.proposedByEmail
                ? `${pending.proposedByEmail} (${pending.proposedBy})`
                : pending.proposedBy,
            })}
          </Text>
          <Text as="span" variant="muted" className="text-xs">
            <TableDateCell date={pending.effectiveAt} />
          </Text>
          {diffs.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {diffs.map((d) => (
                <li key={d.label}>
                  <Text as="span" variant="muted">
                    {d.label}:{' '}
                  </Text>
                  <Text as="span">
                    {d.from} → {d.to}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          icon={Ban}
          onClick={onCancel}
          disabled={cancelDisabled}
        >
          {t('dsarPolicy.pendingBanner.cancel')}
        </Button>
      </div>
    </div>
  );
}
