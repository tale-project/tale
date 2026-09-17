'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useAuth } from '@/app/hooks/use-session-user';
import { useT } from '@/lib/i18n/client';

import { mapDsrError } from './data-subject-requests-errors';

export function ErasureApprovalActions({
  approvalId,
  requestedBy,
  onCancel,
}: {
  approvalId: string | undefined;
  requestedBy: string;
  onCancel: () => void;
}) {
  const { t } = useT('governance');
  const { user } = useAuth();
  const ability = useAbility();
  const { toast } = useToast();
  const mutation = useBackendMutation(
    'approvals/mutations:updateApprovalStatus',
    { errorToast: false },
  );
  const [decision, setDecision] = useState<'executing' | 'rejected' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const canApprove = !!user && user.userId !== requestedBy;
  if (ability.cannot('write', 'orgSettings')) return null;

  const confirm = async () => {
    if (!approvalId || !decision) return;
    setError(null);
    try {
      await mutation.mutateAsync({ approvalId, status: decision });
      setDecision(null);
      toast({
        title: t('dataSubjectRequests.approval.saved'),
        variant: 'success',
      });
    } catch (err) {
      setError(mapDsrError(err, t).description);
    }
  };

  return (
    <>
      <Alert variant="info">
        <Stack gap={3}>
          <Text>{t('dataSubjectRequests.approval.description')}</Text>
          {!canApprove && (
            <Text variant="muted" className="text-sm">
              {t('dataSubjectRequests.errors.dualApprovalRequired')}
            </Text>
          )}
          <Row gap={2} wrap>
            {approvalId && (
              <>
                <Button
                  disabled={!canApprove || mutation.isPending}
                  onClick={() => {
                    setError(null);
                    setDecision('executing');
                  }}
                >
                  {t('dataSubjectRequests.approval.approve')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setError(null);
                    setDecision('rejected');
                  }}
                >
                  {t('dataSubjectRequests.approval.reject')}
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={onCancel}
            >
              {t('dataSubjectRequests.actions.cancel')}
            </Button>
          </Row>
        </Stack>
      </Alert>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={t(
          decision === 'executing'
            ? 'dataSubjectRequests.approval.approve'
            : 'dataSubjectRequests.approval.reject',
        )}
        description={t(
          decision === 'executing'
            ? 'dataSubjectRequests.approval.approveDescription'
            : 'dataSubjectRequests.approval.rejectDescription',
        )}
        confirmText={t(
          decision === 'executing'
            ? 'dataSubjectRequests.approval.approve'
            : 'dataSubjectRequests.approval.reject',
        )}
        isLoading={mutation.isPending}
        onConfirm={() => void confirm()}
      >
        {error && <Alert variant="destructive" description={error} />}
      </ConfirmDialog>
    </>
  );
}
