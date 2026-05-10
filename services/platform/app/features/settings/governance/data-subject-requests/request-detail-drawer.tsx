'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Clock, RefreshCcw } from 'lucide-react';
import { useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Text } from '@/app/components/ui/typography/text';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ExtendDeadlineDialog } from './extend-deadline-dialog';
import { useGetErasureRequest } from './hooks/queries';
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
  const { data, isLoading } = useGetErasureRequest(requestId);
  const [extendOpen, setExtendOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('dataSubjectRequests.drawer.title')}
      description={t('dataSubjectRequests.drawer.description')}
      side="right"
      size="md"
    >
      {isLoading || !data ? (
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

function DrawerBody({ data, onExtend, onRetry }: DrawerBodyProps) {
  const { t } = useT('governance');
  const { request, auditEntries } = data;
  const isTerminal = request.status === 'done' || request.status === 'failed';
  const canExtend = !isTerminal && request.extensionGrantedAt === undefined;
  const canRetry =
    request.status === 'partial' ||
    request.status === 'failed' ||
    request.status === 'blocked';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2 pr-12">
        <h2 className="text-foreground text-lg font-semibold">
          {t('dataSubjectRequests.drawer.headerTitle')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          <SlaCountdownBadge
            slaDeadlineAt={request.slaDeadlineAt}
            extensionDeadlineAt={request.extensionDeadlineAt}
            status={request.status}
          />
        </div>
      </header>

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
        {request.errorMessage && (
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
              <li key={String(entry._id)} className="flex flex-col gap-0.5">
                <Text as="span" className="text-xs font-medium">
                  {entry.action}
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
