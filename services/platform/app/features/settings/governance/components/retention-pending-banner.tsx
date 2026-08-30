'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Row } from '@tale/ui/layout';
import { Clock } from 'lucide-react';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { mapGovernanceSaveError } from '../governance-save-errors';

interface Props {
  organizationId: string;
}

/**
 * Phase 13 — banner at the top of the retention editor showing any
 * pending retention-shortening change. Reads
 * `getPendingRetentionChange` (Phase 3 backend) and exposes a Cancel
 * button calling `cancelPendingRetentionChange`.
 *
 * When no pending change is present the banner renders nothing.
 */
export function RetentionPendingBanner({ organizationId }: Props) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const pending = useBackendQuery(
    'governance/queries:getPendingRetentionChange',
    { organizationId },
  );
  const cancel = useBackendAction(
    'governance/retention_actions:cancelPendingRetentionChange',
  );

  if (!pending.data) return null;

  const { _id, appliesAt, summary } = pending.data;
  const daysRemaining = Math.max(
    0,
    Math.ceil((appliesAt - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return (
    <Alert variant="warning" icon={Clock}>
      <div className="text-foreground flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <Heading
            level={5}
            size="sm"
            weight="medium"
            tracking="tight"
            className="leading-none"
          >
            {t(
              'retentionPolicy.pendingChange.title',
              'A retention reduction is pending.',
            )}
          </Heading>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {summary} —{' '}
            {t(
              'retentionPolicy.pendingChange.applyIn',
              'applies in {days} day(s).',
              { days: daysRemaining },
            )}
          </p>
        </div>
        <Row gap={2} wrap className="shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await cancel.mutateAsync({
                  organizationId,
                  pendingId: _id,
                });
                toast({
                  title: t('toastSavedTitle'),
                  variant: 'success',
                });
              } catch (err) {
                toast({
                  title: t('toastSaveFailedTitle'),
                  description: mapGovernanceSaveError(
                    err,
                    t,
                    t(
                      'retentionPolicy.pendingChange.cancelFailedToast',
                      'Failed to cancel the pending retention change.',
                    ),
                  ),
                  variant: 'destructive',
                });
              }
            }}
          >
            {t('retentionPolicy.pendingChange.cancel', 'Cancel')}
          </Button>
        </Row>
      </div>
    </Alert>
  );
}
