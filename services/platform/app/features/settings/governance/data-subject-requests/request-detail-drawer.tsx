'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { AlertTriangle, Clock, RefreshCcw } from 'lucide-react';
import { useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ExtendDeadlineDialog } from './extend-deadline-dialog';
import { useGetErasureRequest } from './hooks/queries';
import { LegalHoldBlockPanel } from './legal-hold-block-panel';
import { RetryDialog } from './retry-dialog';
import { SlaCountdownBadge } from './sla-countdown-badge';
import { StatusBadge } from './status-badge';

interface RequestDetailDrawerProps {
  organizationId: string;
  requestId: Id<'gdprErasureRequests'>;
  open: boolean;
  onClose: () => void;
}

export function RequestDetailDrawer({
  organizationId,
  requestId,
  open,
  onClose,
}: RequestDetailDrawerProps) {
  const { t } = useT('governance');
  // H8-1: surface query errors. Pre-fix the drawer rendered the
  // skeleton forever when `useGetErasureRequest` threw (deleted row,
  // cross-org access, malformed id) — no error state, no recovery.
  const { data, isLoading, isError, refetch } = useGetErasureRequest(requestId);
  const [extendOpen, setExtendOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // H10-3: align Sheet's sr-only title with the visible drawer
      // header. Pre-fix Sheet announced "Erasure request" while the
      // visible h2 read "Erasure receipt" — two contradictory dialog
      // titles for the same surface.
      title={t('dataSubjectRequests.drawer.headerTitle')}
      description={t('dataSubjectRequests.drawer.description')}
      side="right"
      size="md"
    >
      {isError ? (
        <DrawerErrorState onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <DrawerSkeleton />
      ) : (
        <DrawerBody
          organizationId={organizationId}
          data={data}
          onExtend={() => setExtendOpen(true)}
          onRetry={() => setRetryOpen(true)}
        />
      )}
      {data && (
        <>
          <ExtendDeadlineDialog
            open={extendOpen}
            onOpenChange={setExtendOpen}
            requestId={data.request._id}
          />
          <RetryDialog
            open={retryOpen}
            onOpenChange={setRetryOpen}
            requestId={data.request._id}
          />
        </>
      )}
    </Sheet>
  );
}

function DrawerErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useT('governance');
  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-border bg-muted/30 flex flex-col items-start gap-3 rounded-md border p-4"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="text-destructive size-4" aria-hidden="true" />
        <Text as="span" className="font-medium">
          {t('dataSubjectRequests.drawer.errorState.title')}
        </Text>
      </div>
      <Text variant="muted" className="text-sm">
        {t('dataSubjectRequests.drawer.errorState.description')}
      </Text>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {t('dataSubjectRequests.drawer.errorState.retry')}
      </Button>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

interface DrawerBodyProps {
  organizationId: string;
  data: NonNullable<ReturnType<typeof useGetErasureRequest>['data']>;
  onExtend: () => void;
  onRetry: () => void;
}

function DrawerBody({
  data,
  organizationId,
  onExtend,
  onRetry,
}: DrawerBodyProps) {
  const { t } = useT('governance');
  const { request, auditEntries } = data;
  const isTerminal = request.status === 'done' || request.status === 'failed';
  // H8-5: also gate on the original deadline so a lapsed request hides
  // the Extend button (server rejects with `DEADLINE_LAPSED` per Art
  // 12(3) — the UI shouldn't surface an action that can't succeed).
  const canExtend =
    !isTerminal &&
    request.extensionGrantedAt === undefined &&
    request.slaDeadlineAt > Date.now();
  const canRetry =
    request.status === 'partial' ||
    request.status === 'failed' ||
    request.status === 'blocked';
  // H8-3: when the request was refused at scheduling time by the legal-hold
  // gate, render the LegalHoldBlockPanel (which deep-links to the hold UI)
  // instead of the raw `errorMessage` token (`org_hold` / `user_custodian_hold`).
  const isBlocked = request.status === 'blocked';

  return (
    <div className="flex flex-col gap-5">
      {/* H10-3: the visible <h2> here was previously redundant with
          Sheet's sr-only DialogPrimitive.Title (different strings for
          the same dialog). Sheet now carries `headerTitle` as both the
          visible label and the sr-only Title. The status badges remain
          in the body since they're sub-header content. */}
      <header className="flex flex-wrap items-center gap-2 pr-12">
        <StatusBadge status={request.status} />
        <SlaCountdownBadge
          slaDeadlineAt={request.slaDeadlineAt}
          extensionDeadlineAt={request.extensionDeadlineAt}
          status={request.status}
        />
      </header>

      {isBlocked && (
        <LegalHoldBlockPanel
          organizationId={organizationId}
          requestId={request._id}
        />
      )}

      <Section title={t('dataSubjectRequests.drawer.subjectSection')}>
        <KeyValue
          label={t('dataSubjectRequests.columns.target')}
          value={request.targetUserName}
          mono={request.targetUserName === request.targetUserId}
        />
        <KeyValue
          label={t('dataSubjectRequests.columns.reasonCode')}
          value={
            request.reasonCode
              ? t(`dataSubjectRequests.reasonCodes.${request.reasonCode}.label`)
              : '—'
          }
        />
        <KeyValue
          label={t('dataSubjectRequests.drawer.reasonNarrative')}
          value={request.reason}
          multiline
        />
        <KeyValue
          label={t('dataSubjectRequests.columns.requestedBy')}
          value={request.requestedByName}
        />
        <KeyValueDate
          label={t('dataSubjectRequests.columns.requestedAt')}
          ms={request.requestedAt}
        />
        <KeyValueDate
          label={t('dataSubjectRequests.drawer.slaDeadline')}
          ms={request.extensionDeadlineAt ?? request.slaDeadlineAt}
        />
        {request.extensionGrantedAt !== undefined && (
          <div className="bg-muted/30 flex flex-col gap-1 rounded-md p-2 text-xs">
            <Text as="span" className="font-medium">
              {t('dataSubjectRequests.drawer.extensionGrantedTitle', {
                name:
                  request.extensionGrantedByName ??
                  request.extensionGrantedBy ??
                  '',
              })}
            </Text>
            {request.extensionReason && (
              <Text as="span" variant="muted">
                {request.extensionReason}
              </Text>
            )}
          </div>
        )}
      </Section>

      <Section title={t('dataSubjectRequests.drawer.countersSection')}>
        <KeyValue
          label={t('dataSubjectRequests.drawer.threadsErased')}
          value={`${request.threadsErased ?? 0} / ${
            request.threadsTargeted?.length ?? 0
          }`}
        />
        {(request.threadsSkippedByHold ?? 0) > 0 && (
          <KeyValue
            label={t('dataSubjectRequests.drawer.threadsSkippedByHold')}
            value={String(request.threadsSkippedByHold)}
          />
        )}
        <KeyValue
          label={t('dataSubjectRequests.drawer.ragDocumentsRemoved')}
          value={String(request.ragDocumentsRemoved ?? 0)}
        />
        <KeyValue
          label={t('dataSubjectRequests.drawer.documentsErased')}
          value={String(request.documentsErased ?? 0)}
        />
        {(request.documentsSkippedByHold ?? 0) > 0 && (
          <KeyValue
            label={t('dataSubjectRequests.drawer.documentsSkippedByHold')}
            value={String(request.documentsSkippedByHold)}
          />
        )}
        {(request.threadsBlockedByHold?.length ?? 0) > 0 && (
          <KeyValue
            label={t('dataSubjectRequests.drawer.threadsBlockedByHold')}
            value={String(request.threadsBlockedByHold?.length)}
          />
        )}
        {(request.documentsBlockedByHold?.length ?? 0) > 0 && (
          <KeyValue
            label={t('dataSubjectRequests.drawer.documentsBlockedByHold')}
            value={String(request.documentsBlockedByHold?.length)}
          />
        )}
        {request.startedAt !== undefined && (
          <KeyValueDate
            label={t('dataSubjectRequests.drawer.startedAt')}
            ms={request.startedAt}
          />
        )}
        {request.completedAt !== undefined && (
          <KeyValueDate
            label={t('dataSubjectRequests.drawer.completedAt')}
            ms={request.completedAt}
          />
        )}
        {/* Suppress raw `errorMessage` for blocked rows — the
            LegalHoldBlockPanel above carries the operator-actionable
            framing instead of the bare `org_hold` / `user_custodian_hold`
            sentinel string. */}
        {request.errorMessage && !isBlocked && (
          <KeyValue
            label={t('dataSubjectRequests.drawer.errorMessage')}
            value={request.errorMessage}
            multiline
          />
        )}
      </Section>

      <Section title={t('dataSubjectRequests.drawer.auditSection')}>
        {auditEntries.length === 0 ? (
          <Text variant="muted" className="text-xs">
            {t('dataSubjectRequests.drawer.auditEmpty')}
          </Text>
        ) : (
          <ol className="border-border flex flex-col gap-2 border-l pl-3">
            {auditEntries.map((entry) => (
              <li key={entry._id} className="flex flex-col gap-0.5">
                <Text as="span" className="text-xs font-medium">
                  {/* H8-2: translate machine action names. Falls back
                      to the raw token for any future action that
                      hasn't been added to the i18n bundle yet. */}
                  {t(
                    `dataSubjectRequests.auditActions.${entry.action}`,
                    entry.action,
                  )}
                </Text>
                <Text as="span" variant="muted" className="text-xs">
                  <TableDateCell date={entry.timestamp} />
                  {entry.errorMessage ? ` — ${entry.errorMessage}` : ''}
                </Text>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <footer className="flex flex-wrap gap-2">
        {canExtend && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Clock}
            onClick={onExtend}
          >
            {t('dataSubjectRequests.actions.extendDeadline')}
          </Button>
        )}
        {canRetry && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={RefreshCcw}
            onClick={onRetry}
          >
            {t('dataSubjectRequests.actions.retry')}
          </Button>
        )}
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

interface KeyValueProps {
  label: string;
  value: string;
  multiline?: boolean;
  mono?: boolean;
}

function KeyValue({ label, value, multiline, mono }: KeyValueProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text as="span" variant="muted" className="text-xs">
        {label}
      </Text>
      <Text
        as="span"
        className={
          multiline
            ? 'text-sm whitespace-pre-wrap'
            : mono
              ? 'font-mono text-xs'
              : 'text-sm'
        }
      >
        {value}
      </Text>
    </div>
  );
}

function KeyValueDate({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text as="span" variant="muted" className="text-xs">
        {label}
      </Text>
      <Text as="span" className="text-sm">
        <TableDateCell date={ms} />
      </Text>
    </div>
  );
}
