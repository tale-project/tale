'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { JsonViewer } from '@tale/ui/json-viewer';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useRetryFocus } from '@tale/ui/use-retry-focus';
import { RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useResolveRunApproval } from '../hooks/mutations';
import { useRunApproval } from '../hooks/queries';
import { automationErrorCode } from '../lib/errors';

/** `approval:<id>` — the detail a run parked on a write-approval carries. */
const APPROVAL_DETAIL_RE = /^approval:([a-z0-9]+(?:-[a-z0-9]+)*)$/i;

export function approvalIdFromDetail(
  detail: string | null | undefined,
): string | undefined {
  const match =
    typeof detail === 'string' ? APPROVAL_DETAIL_RE.exec(detail) : null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the id came out of the run's own detail; a stale one reads as null downstream
  return match ? match[1] : undefined;
}

/**
 * The human gate of a LIVE run, where the human is already looking: a waiting
 * run's approval rendered as a card with the operation, its input, and the
 * approve/reject decision. Approving lets the parked node act on the
 * stepper's next poll; rejecting fails it. Without this card a live run's
 * write nodes have no reachable decision surface at all.
 *
 * Everything the card shows belongs to ONE approval. A new `approvalId` —
 * the run reaching its next gate, or the panel now showing another task's
 * run — mounts a fresh card, so a refusal (or a late answer) given for the
 * previous approval never shows under this one.
 */
export function RunApprovalCard({
  organizationId,
  approvalId,
}: {
  organizationId: string;
  approvalId: string;
}) {
  return (
    <ApprovalDecisionCard
      key={approvalId}
      organizationId={organizationId}
      approvalId={approvalId}
    />
  );
}

type Decision = 'executing' | 'rejected';

/** What this card's own press last came to. */
type Submission =
  | { kind: 'recorded'; status: Decision }
  | { kind: 'failed'; detail: string | undefined };

/**
 * The caller chose this card over its own waiting banner, so the card owns
 * every state of the approval's read: while it loads, and after it fails, it
 * still says the run waits for a decision, and a failed read offers Try
 * again. Only a settled answer that no such approval exists falls back to
 * the plain waiting banner. Loading, failed and pending share one mounted
 * tree, so the card holds its place as the read resolves.
 */
function ApprovalDecisionCard({
  organizationId,
  approvalId,
}: {
  organizationId: string;
  approvalId: string;
}) {
  const { t } = useT('automations');
  const approvalQuery = useRunApproval(organizationId, approvalId);
  const resolve = useResolveRunApproval();
  const [submission, setSubmission] = useState<Submission | null>(null);

  const approval = approvalQuery.data ?? null;
  const missing =
    approvalQuery.data === null ||
    (approvalQuery.isError &&
      automationErrorCode(approvalQuery.error) === 'NOT_FOUND');
  const loading = approval === null && !approvalQuery.isError;
  const unreadable = approval === null && approvalQuery.isError;
  const retryFocus = useRetryFocus(
    missing || approval !== null ? 'ready' : unreadable ? 'failed' : 'loading',
    approvalId,
  );
  if (approval === null && missing) {
    return <Alert variant="info" description={t('runs.waiting.approval')} />;
  }

  const rawMetadata: unknown = approval?.metadata;
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

  // A recorded press shows its outcome at once; the approval's own read
  // confirms it when it refetches, and wins once it says anything but
  // pending.
  const status =
    approval?.status === 'pending' && submission?.kind === 'recorded'
      ? submission.status
      : approval?.status;

  if (status === 'executing' || status === 'completed') {
    return (
      <Alert
        variant="info"
        description={t('runs.approval.approved', { operation })}
      />
    );
  }
  if (status === 'rejected') {
    return (
      <Alert
        variant="destructive"
        description={t('runs.approval.rejected', { operation })}
      />
    );
  }

  const decide = (decision: Decision) => {
    setSubmission(null);
    resolve.mutateAsync({ approvalId, status: decision }).then(
      () => {
        setSubmission({ kind: 'recorded', status: decision });
      },
      (error: unknown) => {
        setSubmission({ kind: 'failed', detail: failureDetail(error) });
        // Whatever the answer said, the approval's own record decides what
        // the card shows next: someone else may have decided it first, or
        // an earlier press of this one went through.
        void approvalQuery.refetch();
      },
    );
  };

  return (
    <Skeletonize loading={loading} label={t('runs.approval.loading')}>
      <ApprovalFrame
        title={
          approval === null
            ? t('runs.waiting.approval')
            : t('runs.approval.title', { operation })
        }
        note={
          nodeId !== undefined
            ? t('runs.approval.node', { node: nodeId })
            : t('runs.approval.pending')
        }
        actions={
          // Nothing to decide while the operation cannot be read.
          unreadable ? undefined : (
            <DecisionButtons
              pending={resolve.isPending}
              disabled={loading || resolve.isPending}
              onDecide={decide}
            />
          )
        }
      >
        {unreadable ? (
          <div ref={retryFocus.ref}>
            <Alert
              variant="destructive"
              title={t('runs.approval.loadFailed')}
              description={failureDetail(approvalQuery.error)}
            >
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                className="mt-3"
                isLoading={approvalQuery.isFetching}
                onClick={() => {
                  retryFocus.arm();
                  void approvalQuery.refetch();
                }}
              >
                {t('runs.approval.retry')}
              </Button>
            </Alert>
          </div>
        ) : (
          (loading || metadata.parameters !== undefined) && (
            <ApprovalInput
              parameters={loading ? LOADING_INPUT : metadata.parameters}
            />
          )
        )}
        {submission?.kind === 'failed' && (
          <Alert
            variant="destructive"
            title={t('runs.approval.decideFailed')}
            description={submission.detail}
          />
        )}
      </ApprovalFrame>
    </Skeletonize>
  );
}

/** A stand-in the input masks while the approval loads — the shape of a
 * typical call, so the loaded input takes the space it held. */
const LOADING_INPUT = { to: '', subject: '' };

/** What the parked step would call its connector with. */
function ApprovalInput({ parameters }: { parameters: unknown }) {
  const { t } = useT('automations');
  return (
    <div className="flex flex-col gap-1">
      <Text as="p" variant="muted" className="text-xs">
        {t('runs.approval.input')}
      </Text>
      <SkeletonBox asChild>
        <div>
          <JsonViewer data={parameters} collapsed={1} />
        </div>
      </SkeletonBox>
    </div>
  );
}

function ApprovalFrame({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Text as="p" className="text-sm font-medium">
            {title}
          </Text>
          <Text as="p" variant="muted" className="text-xs">
            {note}
          </Text>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Reject and Approve — masked while the approval loads, held while a press
 * is in flight so one decision is never sent twice. */
function DecisionButtons({
  pending = false,
  disabled,
  onDecide,
}: {
  pending?: boolean;
  disabled: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const { t } = useT('automations');
  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onDecide('rejected')}
      >
        {t('runs.approval.reject')}
      </Button>
      <Button
        size="sm"
        disabled={disabled}
        isLoading={pending}
        onClick={() => onDecide('executing')}
      >
        {t('runs.approval.approve')}
      </Button>
    </div>
  );
}
