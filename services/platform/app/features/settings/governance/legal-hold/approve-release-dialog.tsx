'use client';

import { Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useApproveLegalHoldRelease } from '../hooks/mutations';
import { mapLegalHoldError } from './legal-hold-errors';

interface ReleaseRequestSummary {
  _id: Id<'legalHoldReleaseRequests'>;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  reason: string;
}

interface ApproveReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ReleaseRequestSummary | null;
  /** Current viewer's userId, so we can pre-block self-approval. */
  currentUserId: string | undefined;
}

export function ApproveReleaseDialog({
  open,
  onOpenChange,
  request,
  currentUserId,
}: ApproveReleaseDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useApproveLegalHoldRelease();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [tooSoonUntil, setTooSoonUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick the local clock so the inline countdown updates while the
  // dialog stays open and the button auto-re-enables when the gate clears.
  useEffect(() => {
    if (tooSoonUntil === null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tooSoonUntil]);

  // Reset transient state every time we re-open against a new request.
  useEffect(() => {
    if (!open) {
      setFieldError(null);
      setTooSoonUntil(null);
    }
  }, [open]);

  const isSelfApprove = useMemo(
    () =>
      currentUserId !== undefined &&
      request !== null &&
      request.requestedBy === currentUserId,
    [currentUserId, request],
  );

  const tooSoonRemaining = tooSoonUntil ? Math.max(0, tooSoonUntil - now) : 0;
  const tooSoonActive = tooSoonRemaining > 0;

  const onConfirm = async () => {
    if (!request) return;
    setFieldError(null);
    try {
      await mutateAsync({ requestId: request._id });
      toast({
        title: t('legalHold.toasts.releaseApprovedTitle'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (err) {
      const mapped = mapLegalHoldError(err, t);
      if (mapped.fieldError) {
        setFieldError(mapped.fieldError);
        if (mapped.remainingMs !== undefined) {
          setTooSoonUntil(Date.now() + mapped.remainingMs);
        }
        return;
      }
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  };

  const inlineSelfApproveBlocked = isSelfApprove;
  const disableConfirm =
    !request || isPending || inlineSelfApproveBlocked || tooSoonActive;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('legalHold.dialogs.approveRelease.title')}
      description={t('legalHold.dialogs.approveRelease.description')}
      confirmText={t('legalHold.dialogs.approveRelease.submit')}
      isLoading={isPending}
      disableConfirm={disableConfirm}
      onConfirm={onConfirm}
      variant="default"
    >
      <Stack gap={3} className="text-sm">
        {request && (
          <div className="bg-muted rounded-md p-3">
            <Text variant="label" className="text-xs">
              {t('legalHold.columns.requestedBy')}: {request.requestedByName}
            </Text>
            <Text variant="muted" className="text-xs break-words">
              {request.reason}
            </Text>
          </div>
        )}
        {inlineSelfApproveBlocked && (
          <div className="text-destructive flex items-start gap-1.5 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t('legalHold.dialogs.approveRelease.selfApproveBlocked')}
            </span>
          </div>
        )}
        {fieldError && !inlineSelfApproveBlocked && (
          <div className="text-destructive flex items-start gap-1.5 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{fieldError}</span>
          </div>
        )}
      </Stack>
    </ConfirmDialog>
  );
}
