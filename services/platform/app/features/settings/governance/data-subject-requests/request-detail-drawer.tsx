'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { AlertTriangle, Ban, Clock, RefreshCcw, X } from 'lucide-react';
import { useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { CancelDialog } from './cancel-dialog';
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
  const { t: tCommon } = useT('common');
  // H8-1: surface query errors. Pre-fix the drawer rendered the
  // skeleton forever when `useGetErasureRequest` threw (deleted row,
  // cross-org access, malformed id) — no error state, no recovery.
  const { data, isLoading, isError, refetch } = useGetErasureRequest(requestId);
  const [extendOpen, setExtendOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('dataSubjectRequests.drawer.headerTitle')}
      description={t('dataSubjectRequests.drawer.description')}
      side="right"
      size="md"
      // Match the provider / SSO / integration panels: a bordered title bar
      // + scrollable body instead of the default floating-X + p-6 chrome.
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('dataSubjectRequests.drawer.headerTitle')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={onClose}
        />
      </HStack>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        {isError ? (
          <DrawerErrorState onRetry={() => void refetch()} />
        ) : (
          // Render the REAL `DrawerBody` once, always, wrapped in
          // `<Skeletonize>`; while the read is in flight feed it placeholder
          // data so the dynamic leaves (masked in place) reserve their real
          // height instead of swapping in a separate skeleton tree.
          <Skeletonize
            loading={isLoading || !data}
            label={t('dataSubjectRequests.drawer.headerTitle')}
          >
            <DrawerBody
              organizationId={organizationId}
              data={data ?? PLACEHOLDER_DRAWER_DATA}
              onExtend={() => setExtendOpen(true)}
              onRetry={() => setRetryOpen(true)}
              onCancel={() => setCancelOpen(true)}
            />
          </Skeletonize>
        )}
      </div>
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
          <CancelDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
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
    <Stack
      role="alert"
      aria-live="polite"
      gap={3}
      align="start"
      className="border-border bg-muted/30 rounded-md border p-4"
    >
      <Row gap={2}>
        <AlertTriangle className="text-destructive size-4" aria-hidden="true" />
        <Text as="span" className="font-medium">
          {t('dataSubjectRequests.drawer.errorState.title')}
        </Text>
      </Row>
      <Text variant="muted" className="text-sm">
        {t('dataSubjectRequests.drawer.errorState.description')}
      </Text>
      <Button type="button" variant="secondary" onClick={onRetry}>
        {t('dataSubjectRequests.drawer.errorState.retry')}
      </Button>
    </Stack>
  );
}

type DrawerData = NonNullable<ReturnType<typeof useGetErasureRequest>['data']>;

// Placeholder fed to the REAL `DrawerBody` while the read is in flight, so the
// masked leaves reserve their natural size. `status: 'running'` keeps every
// conditional banner (cooling-off / cancelled / blocked / extension) closed, so
// the loading layout shows the stable subset (header + sections + footer).
// Intentionally partial: only the fields the masked `DrawerBody` reads are set.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const PLACEHOLDER_DRAWER_DATA = {
  request: {
    status: 'running',
    targetUserName: 'Placeholder user',
    targetUserId: 'placeholder',
    requestedByName: 'Placeholder admin',
    requestedAt: 0,
    slaDeadlineAt: 0,
    threadsErased: 0,
    threadsTargeted: [],
    ragDocumentsRemoved: 0,
    documentsErased: 0,
    wfExecutionsErased: 0,
  },
  auditEntries: [],
} as unknown as DrawerData;

interface DrawerBodyProps {
  organizationId: string;
  data: NonNullable<ReturnType<typeof useGetErasureRequest>['data']>;
  onExtend: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

function DrawerBody({
  data,
  organizationId,
  onExtend,
  onRetry,
  onCancel,
}: DrawerBodyProps) {
  const { t } = useT('governance');
  const { request, auditEntries } = data;
  const now = Date.now();
  const isTerminal = request.status === 'done' || request.status === 'failed';
  // H8-5: also gate on the original deadline so a lapsed request hides
  // the Extend button (server rejects with `DEADLINE_LAPSED` per Art
  // 12(3) — the UI shouldn't surface an action that can't succeed).
  const canExtend =
    !isTerminal &&
    request.extensionGrantedAt === undefined &&
    request.slaDeadlineAt > now;
  const canRetry =
    request.status === 'partial' ||
    request.status === 'failed' ||
    request.status === 'blocked';
  // H8-3: when the request was refused at scheduling time by the legal-hold
  // gate, render the LegalHoldBlockPanel (which deep-links to the hold UI)
  // instead of the raw `errorMessage` token (`org_hold` / `user_custodian_hold`).
  const isBlocked = request.status === 'blocked';
  const isCancelled = request.status === 'cancelled';
  // Cooling-off window: status='pending' AND effectiveAt in the future.
  // Any admin can cancel during this window. Past cooling-off, the
  // server flips status to 'running' and refuses the cancel mutation.
  const isCoolingOff =
    request.status === 'pending' &&
    request.effectiveAt !== undefined &&
    request.effectiveAt > now;

  return (
    <Stack gap={5}>
      <Row as="header" gap={2} wrap className="pr-12">
        <SkeletonBox>
          <StatusBadge
            status={request.status}
            effectiveAt={request.effectiveAt}
          />
        </SkeletonBox>
        <SkeletonBox>
          <SlaCountdownBadge
            slaDeadlineAt={request.slaDeadlineAt}
            extensionDeadlineAt={request.extensionDeadlineAt}
            status={request.status}
          />
        </SkeletonBox>
      </Row>

      {isCoolingOff && request.effectiveAt !== undefined && (
        <CoolingOffBanner
          effectiveAt={request.effectiveAt}
          onCancel={onCancel}
        />
      )}

      {isCancelled && <CancelledBlock data={data} />}

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
          <Stack gap={1} className="bg-muted/30 rounded-md p-2 text-xs">
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
          </Stack>
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
        <KeyValue
          label={t('dataSubjectRequests.drawer.wfExecutionsErased')}
          value={String(request.wfExecutionsErased ?? 0)}
        />
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
          <Stack as="ol" gap={2} className="border-border border-l pl-3">
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
          </Stack>
        )}
      </Section>

      {request.perCategorySnapshot && (
        <FullBreakdown snapshot={request.perCategorySnapshot} />
      )}

      <Row as="footer" gap={2} align="stretch" wrap>
        {canExtend && (
          <Button
            type="button"
            variant="secondary"
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
            icon={RefreshCcw}
            onClick={onRetry}
          >
            {t('dataSubjectRequests.actions.retry')}
          </Button>
        )}
      </Row>
    </Stack>
  );
}

function CoolingOffBanner({
  effectiveAt,
  onCancel,
}: {
  effectiveAt: number;
  onCancel: () => void;
}) {
  const { t } = useT('governance');
  return (
    <Alert variant="warning" className="text-sm">
      <Stack gap={2}>
        <Row gap={2} align="start">
          <Clock
            className="text-warning mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <Stack gap={1}>
            <Text as="span" className="font-medium">
              {t('dataSubjectRequests.drawer.coolingOffBanner.title')}
            </Text>
            <Text as="span" variant="muted" className="text-xs">
              {t('dataSubjectRequests.drawer.coolingOffBanner.description')}
            </Text>
            <Text as="span" variant="muted" className="text-xs">
              <TableDateCell date={effectiveAt} />
            </Text>
          </Stack>
        </Row>
        <Row gap={0} align="stretch" justify="end">
          <Button
            type="button"
            variant="destructive"
            icon={Ban}
            onClick={onCancel}
          >
            {t('dataSubjectRequests.actions.cancel')}
          </Button>
        </Row>
      </Stack>
    </Alert>
  );
}

function CancelledBlock({
  data,
}: {
  data: NonNullable<ReturnType<typeof useGetErasureRequest>['data']>;
}) {
  const { t } = useT('governance');
  const { request } = data;
  return (
    <Stack
      role="status"
      gap={2}
      className="border-border bg-muted/30 text-foreground rounded-md border p-3 text-sm"
    >
      <Row gap={2} align="start">
        <Ban
          className="text-muted-foreground mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <Stack gap={1} className="flex-1">
          <Text as="span" className="font-medium">
            {t('dataSubjectRequests.drawer.cancelledBlock.title')}
          </Text>
          {request.cancellationReason && (
            <Text as="span" variant="muted" className="text-xs">
              {request.cancellationReason}
            </Text>
          )}
          <Text as="span" variant="muted" className="text-xs">
            {t('dataSubjectRequests.drawer.cancelledBlock.attribution', {
              name: request.cancelledByName ?? request.cancelledBy ?? '',
            })}
          </Text>
          {request.cancelledAt !== undefined && (
            <Text as="span" variant="muted" className="text-xs">
              <TableDateCell date={request.cancelledAt} />
            </Text>
          )}
        </Stack>
      </Row>
    </Stack>
  );
}

interface PerCategoryEntry {
  rows?: number;
  skippedByHold?: number;
  blobs?: number;
  attempts?: number;
  blockCounters?: number;
}

function FullBreakdown({ snapshot }: { snapshot: Record<string, unknown> }) {
  const { t } = useT('governance');
  // Sort entries: non-zero first, zero-value categories collapsed to a
  // count at the bottom. Each known field uses an i18n label; unknown
  // category names fall back to the raw key.
  const entries = Object.entries(snapshot);
  const visible: { key: string; rows: number; skippedByHold: number }[] = [];
  let zeroCount = 0;
  for (const [key, value] of entries) {
    if (typeof value !== 'object' || value === null) continue;
    const e = value as PerCategoryEntry;
    // `loginAttempts` uses {attempts, blockCounters} instead of {rows};
    // sum them as the "rows" view for the breakdown.
    const rows =
      typeof e.rows === 'number'
        ? e.rows
        : (e.attempts ?? 0) + (e.blockCounters ?? 0);
    const skippedByHold = e.skippedByHold ?? 0;
    if (rows === 0 && skippedByHold === 0) {
      zeroCount++;
    } else {
      visible.push({ key, rows, skippedByHold });
    }
  }

  return (
    <details className="border-border bg-muted/20 group rounded-md border p-2 text-sm">
      <summary className="text-foreground cursor-pointer px-1 py-1 font-medium select-none">
        {t('dataSubjectRequests.drawer.fullBreakdownTitle')}
      </summary>
      <dl className="mt-2 flex flex-col gap-1 px-1">
        {visible.map(({ key, rows, skippedByHold }) => (
          <Row
            key={key}
            gap={2}
            align="stretch"
            justify="between"
            className="text-xs"
          >
            <dt className="text-muted-foreground">
              {t(`dataSubjectRequests.categories.${key}`, key)}
            </dt>
            <dd>
              {t('dataSubjectRequests.drawer.fullBreakdownEntry', {
                rows,
                skippedByHold,
              })}
            </dd>
          </Row>
        ))}
        {zeroCount > 0 && (
          <Text as="span" variant="muted" className="text-xs italic">
            {t('dataSubjectRequests.drawer.fullBreakdownNoData', {
              count: zeroCount,
            })}
          </Text>
        )}
      </dl>
    </details>
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
    <Stack as="section" gap={2}>
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      <Stack gap={2}>{children}</Stack>
    </Stack>
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
        <SkeletonBox>{value}</SkeletonBox>
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
        <SkeletonBox>
          <TableDateCell date={ms} />
        </SkeletonBox>
      </Text>
    </div>
  );
}
