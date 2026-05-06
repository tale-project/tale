'use client';

import { Button } from '@tale/ui/button';
import { useMutation } from 'convex/react';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useDataClassificationNotice } from '../hooks/use-data-classification-notice';

interface Props {
  organizationId: string | undefined;
}

/**
 * Phase 12 — one-time ack modal.
 *
 * Fires when:
 *   - The org's `data_classification_notice` policy has
 *     `requireAcknowledgment: true`, AND
 *   - The current user has either no `policyAcknowledgements` row for
 *     this policyType, OR the row's `policyVersion` is older than the
 *     live policy `version`.
 *
 * Calling `acknowledgePolicy` writes a fresh row pinned to the current
 * version; subsequent loads suppress the modal until admins bump
 * `version` again.
 */
export function DataNoticeAckModal({ organizationId }: Props) {
  const { t } = useT('dataNotice');
  const notice = useDataClassificationNotice(organizationId);
  const ack = useConvexQuery(
    api.governance.policy_acknowledgements.getPolicyAcknowledgement,
    organizationId
      ? { organizationId, policyType: 'data_classification_notice' }
      : 'skip',
  );
  const acknowledge = useMutation(
    api.governance.policy_acknowledgements.acknowledgePolicy,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    if (!notice.enabled) return;
    if (!notice.requireAcknowledgment) return;
    if (ack.isLoading) return;
    const acknowledged = ack.data && ack.data.policyVersion >= notice.version;
    setOpen(!acknowledged);
  }, [
    organizationId,
    notice.enabled,
    notice.requireAcknowledgment,
    notice.version,
    ack.data,
    ack.isLoading,
  ]);

  if (!organizationId) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('ack.title', 'Data handling notice')}
      description={t(
        'ack.body',
        "Before you continue, please review your organisation's data policy.",
      )}
      icon={<ShieldAlert className="text-warning h-5 w-5" aria-hidden="true" />}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('ack.later', 'Later')}
          </Button>
          <Button
            onClick={async () => {
              // policyVersion is pinned server-side from the live
              // governancePolicies row — see acknowledgePolicy.
              await acknowledge({
                organizationId,
                policyType: 'data_classification_notice',
              });
              setOpen(false);
            }}
          >
            {t('ack.confirm', 'I understand')}
          </Button>
        </>
      }
    >
      <div className="bg-muted/30 rounded border p-3 text-sm">
        {notice.message}
      </div>
    </Dialog>
  );
}
