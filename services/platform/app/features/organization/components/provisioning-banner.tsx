'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';

import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useProvisioningStatus, useRetryProvisioning } from '../hooks/actions';

/**
 * Dashboard banner shown when this org's create-time scaffold didn't finish —
 * the org exists but scaffolded config domains that should have been seeded
 * from the built-in catalog are still empty (node actions down at create
 * time, crash mid-scaffold). Without it the org looks innocently new while
 * agents/chat are actually broken (#2636).
 *
 * Only roles with developer-settings access see it (the probe and the repair
 * action are gated on that capability server-side, mirroring the per-domain
 * catalog sync). Retry re-runs the full scaffold idempotently — every domain,
 * providers + governance included — and the derived status self-clears once
 * the files land.
 *
 * Mirrors the TwoFactor banners' structure deliberately (same shell mount
 * above nav + main, same warning colours) so the shell banners feel consistent.
 */
export function ProvisioningBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('provisioning');
  const ability = useAbility();
  const canRepair = ability.can('read', 'developerSettings');

  const status = useProvisioningStatus(organizationId, canRepair);
  const { mutateAsync: retryProvisioning, isPending } = useRetryProvisioning();

  if (!canRepair || !status.data || status.data.provisioned) return null;

  const handleRetry = async () => {
    try {
      const result = await retryProvisioning({ organizationId });
      if (result.ok) {
        toast({ title: t('toast.retrySucceeded'), variant: 'success' });
      } else {
        toast({ title: t('toast.retryFailed'), variant: 'destructive' });
      }
    } catch (err) {
      console.error('Provisioning retry failed:', err);
      toast({ title: t('toast.retryFailed'), variant: 'destructive' });
    } finally {
      // The status is file-derived, so re-probing after the retry either
      // clears the banner (repaired) or keeps it for another attempt.
      await status.refetch();
    }
  };

  // Full-bleed strip above the dashboard chrome (not an inset card in main) so
  // the chat/page header stays aligned with the nav rail.
  return (
    <Row
      role="status"
      gap={2}
      wrap
      className="bg-warning/10 border-warning/30 shrink-0 border-b px-4 py-3 text-sm"
    >
      <span className="grow">
        <span className="font-medium">{t('banner.title')}</span>
        {' — '}
        {t('banner.body')}
      </span>
      <Button
        variant="secondary"
        size="sm"
        isLoading={isPending}
        onClick={() => void handleRetry()}
      >
        {isPending ? t('banner.retrying') : t('banner.retry')}
      </Button>
    </Row>
  );
}
