'use client';

import { Button } from '@tale/ui/button';
import { useMutation } from 'convex/react';
import { Clock } from 'lucide-react';

import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

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
  const pending = useConvexQuery(
    api.governance.queries.getPendingRetentionChange,
    { organizationId },
  );
  const cancel = useMutation(
    api.governance.mutations.cancelPendingRetentionChange,
  );

  if (!pending.data) return null;

  const { _id, appliesAt, summary } = pending.data;
  const daysRemaining = Math.max(
    0,
    Math.ceil((appliesAt - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return (
    <div className="border-warning bg-warning/10 flex items-start gap-3 rounded border p-3">
      <Clock className="text-warning mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <Text className="text-sm font-medium">
          {t(
            'retentionPolicy.pendingChange.title',
            'A retention reduction is pending.',
          )}
        </Text>
        <Text className="text-muted-foreground text-xs">
          {summary} —{' '}
          {t(
            'retentionPolicy.pendingChange.applyIn',
            'applies in {days} day(s).',
            { days: daysRemaining },
          )}
        </Text>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            await cancel({
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
              description: err instanceof Error ? err.message : String(err),
              variant: 'destructive',
            });
          }
        }}
      >
        {t('retentionPolicy.pendingChange.cancel', 'Cancel')}
      </Button>
    </div>
  );
}
