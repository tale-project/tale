'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import { useResolveRunApproval } from '../hooks/mutations';
import { useRunApproval } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';

/** `approval:<id>` — the detail a run parked on a write-approval carries. */
const APPROVAL_DETAIL_RE = /^approval:([a-z0-9]+)$/;

export function approvalIdFromDetail(
  detail: string | undefined,
): string | undefined {
  const match = detail === undefined ? null : APPROVAL_DETAIL_RE.exec(detail);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came out of the run's own detail; a stale one reads as null downstream
  return match ? match[1] : undefined;
}

/**
 * The human gate of a LIVE run, where the human is already looking: a waiting
 * run's approval rendered as a card with the operation, its input, and the
 * approve/reject decision. Approving lets the parked node act on the
 * stepper's next poll; rejecting fails it. Without this card a live run's
 * write nodes have no reachable decision surface at all.
 */
export function RunApprovalCard({
  organizationId,
  approvalId,
}: {
  organizationId: string;
  approvalId: string;
}) {
  const { t } = useT('automations');
  const approvalQuery = useRunApproval(organizationId, approvalId);
  const resolve = useResolveRunApproval();
  const [refusal, setRefusal] = useState<string | null>(null);

  const approval = approvalQuery.data ?? null;
  if (approval === null) {
    // Loading, or a stale reference (approval already consumed) — the plain
    // waiting banner is rendered by the caller in that case.
    return null;
  }

  const rawMetadata: unknown = approval.metadata;
  const metadata: Record<string, unknown> =
    rawMetadata !== null &&
    typeof rawMetadata === 'object' &&
    !Array.isArray(rawMetadata)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        (rawMetadata as Record<string, unknown>)
      : {};
  const connector =
    typeof metadata.connector === 'string' ? metadata.connector : '';
  const action = typeof metadata.action === 'string' ? metadata.action : '';
  const nodeId =
    typeof metadata.nodeId === 'string' ? metadata.nodeId : undefined;
  const operation = connector !== '' ? `${connector}.${action}` : action;

  if (approval.status === 'executing' || approval.status === 'completed') {
    return (
      <Alert
        variant="info"
        description={t('runs.approval.approved', { operation })}
      />
    );
  }
  if (approval.status === 'rejected') {
    return (
      <Alert
        variant="destructive"
        description={t('runs.approval.rejected', { operation })}
      />
    );
  }

  const decide = (status: 'executing' | 'rejected') => {
    setRefusal(null);
    resolve.mutate(
      { approvalId, status },
      {
        onError: (error) => {
          setRefusal(automationErrorMessage(error));
        },
      },
    );
  };

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Text as="p" className="text-sm font-medium">
            {t('runs.approval.title', { operation })}
          </Text>
          <Text as="p" variant="muted" className="text-xs">
            {nodeId !== undefined
              ? t('runs.approval.node', { node: nodeId })
              : t('runs.approval.pending')}
          </Text>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={resolve.isPending}
            onClick={() => decide('rejected')}
          >
            {t('runs.approval.reject')}
          </Button>
          <Button
            size="sm"
            isLoading={resolve.isPending}
            onClick={() => decide('executing')}
          >
            {t('runs.approval.approve')}
          </Button>
        </div>
      </div>
      {metadata.parameters !== undefined && (
        <div className="flex flex-col gap-1">
          <Text as="p" variant="muted" className="text-xs">
            {t('runs.approval.input')}
          </Text>
          <JsonViewer data={metadata.parameters} collapsed={1} />
        </div>
      )}
      {refusal !== null && (
        <Alert variant="destructive" description={refusal} />
      )}
    </div>
  );
}
