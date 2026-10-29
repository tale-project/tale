'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { InlineCode } from '@tale/ui/inline-code';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { useCallback, useRef, type ReactNode } from 'react';

import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import {
  useIntegrityStatus,
  useVerifyIntegrity,
  type IntegrityStatus,
} from '../hooks/integrity';

interface AuditIntegrityPanelProps {
  organizationId: string;
  /**
   * Reveal a specific audit row in the table's detail dialog. Used by the
   * broken-row "open entry" affordance so an admin can jump straight from a
   * verification failure to the offending row.
   */
  onOpenRow: (logId: string) => void;
}

/**
 * Admin-only chain-integrity panel for the audit-log page (#1845). Surfaces the
 * scheduled integrity-check status (last automated run + whether an incident
 * alert is armed), a "verify now" button that runs `verifyIntegrity` on demand,
 * and the structured break details when the chain is broken — closing the loop
 * the "investigate immediately" alert previously left open.
 */
export function AuditIntegrityPanel({
  organizationId,
  onOpenRow,
}: AuditIntegrityPanelProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const { toast } = useToast();

  const status = useIntegrityStatus(organizationId);
  const verify = useVerifyIntegrity();

  // A status that failed to load is named, with Try again — never passed off
  // as "no check has run", which would hide an alert the status carries
  // (#4834). The flags hold through a retry, which react-query starts from
  // `pending` for a status that never answered.
  const read = readStateOf(status);
  const { refetch: refetchStatus } = status;
  const retryStatus = useCallback(() => void refetchStatus(), [refetchStatus]);
  // Where the focus goes when a Try again that worked takes its notice away.
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPanel = useCallback(() => panelRef.current?.focus(), []);

  const handleVerify = useCallback(() => {
    verify.mutate(
      { organizationId },
      {
        onError: () => {
          toast({
            title: t('logs.integrity.verifyError'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [verify, organizationId, toast, t]);

  const s = status.data;
  const result = verify.data;
  // Capture the break details as narrowed locals so the JSX guards flow the
  // non-undefined type into the closures below (no `!` assertions).
  const brokenAt = result && !result.valid ? result.firstBrokenAt : undefined;

  return (
    <BorderedSection
      ref={panelRef}
      role="region"
      aria-label={t('logs.integrity.title')}
      tabIndex={-1}
      className="outline-none"
    >
      <Row className="items-start justify-between gap-3">
        <Stack gap={1} className="min-w-0">
          <Row gap={2} className="flex-wrap items-center">
            <Text as="span" className="text-foreground text-sm font-medium">
              {t('logs.integrity.title')}
            </Text>
            <StatusBadge status={s} t={t} />
          </Row>
          <Stack gap={1}>
            {/* Like the badge: until the status answers the line masks
                rather than claim no check has ever run, and a status that
                failed to load is named below instead. */}
            {s === undefined ? (
              read.unavailable ? null : (
                <Text as="span" variant="muted" className="text-xs">
                  <span className="block w-56 max-w-full">
                    <SkeletonText />
                  </span>
                </Text>
              )
            ) : (
              <Text as="span" variant="muted" className="text-xs">
                {s === null
                  ? t('logs.integrity.neverChecked')
                  : t('logs.integrity.lastCheck', {
                      date: formatDate(new Date(s.updatedAt), 'long'),
                    })}
              </Text>
            )}
            {s?.alertActive && s.lastAlertedAt !== undefined && (
              <Text as="span" variant="muted" className="text-xs">
                {t('logs.integrity.alertedAt', {
                  date: formatDate(new Date(s.lastAlertedAt), 'long'),
                })}
              </Text>
            )}
          </Stack>
        </Stack>
        <Button
          variant="secondary"
          isLoading={verify.isPending}
          disabled={verify.isPending}
          onClick={handleVerify}
        >
          {t('logs.integrity.verifyNow')}
        </Button>
      </Row>

      {(read.unavailable || read.stale) && (
        <CatalogLoadError
          // Each failure is announced again; Try again keeps its node, and the
          // focus on it, through a retry that fails again.
          failureKey={read.failureCount}
          message={
            read.unavailable
              ? t('logs.integrity.loadFailed')
              : t('logs.integrity.refreshFailed')
          }
          onRetry={retryStatus}
          isRetrying={read.retrying}
          onFocusLost={focusPanel}
        />
      )}

      {result?.valid && (
        <Alert
          variant="info"
          icon={CheckCircle2}
          title={t('logs.integrity.resultValidTitle')}
        >
          <Stack gap={1} className="text-sm">
            <span>
              {t('logs.integrity.resultValidBody', {
                count: result.verifiedCount,
              })}
            </span>
            {result.truncated && (
              <span>
                {t('logs.integrity.truncatedNote', {
                  count: result.verifiedCount,
                })}
              </span>
            )}
            {result.unsignedScrubCount > 0 && (
              <span>
                {t('logs.integrity.unsignedScrubNote', {
                  count: result.unsignedScrubCount,
                })}
              </span>
            )}
            {result.awaitingSeal.count > 0 && (
              <span>
                {t('logs.integrity.awaitingSealNote', {
                  count: result.awaitingSeal.count,
                })}
              </span>
            )}
          </Stack>
        </Alert>
      )}

      {brokenAt && (
        <Alert
          variant="destructive"
          icon={ShieldAlert}
          live="assertive"
          title={t('logs.integrity.brokenTitle')}
        >
          <Stack gap={3}>
            <Text as="span" variant="muted" className="text-sm">
              {t('logs.integrity.brokenBody')}
            </Text>
            <Stack gap={2}>
              <Field label={t('logs.integrity.brokenAt')}>
                {formatDate(new Date(brokenAt.timestamp), 'long')}
              </Field>
              <Field label={t('logs.integrity.logId')}>
                <InlineCode className="break-all">{brokenAt.logId}</InlineCode>
              </Field>
              <Field label={t('logs.integrity.expectedHash')}>
                <InlineCode className="break-all">
                  {brokenAt.expected}
                </InlineCode>
              </Field>
              <Field label={t('logs.integrity.actualHash')}>
                <InlineCode className="break-all">{brokenAt.actual}</InlineCode>
              </Field>
            </Stack>
            <div>
              <Button
                variant="secondary"
                icon={ShieldAlert}
                onClick={() => onOpenRow(brokenAt.logId)}
              >
                {t('logs.integrity.openRow')}
              </Button>
            </div>
          </Stack>
        </Alert>
      )}
    </BorderedSection>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: IntegrityStatus | undefined;
  t: (key: string) => string;
}) {
  // No answer yet — the read is in flight, or it failed — claims nothing: a
  // "not yet checked" badge over a status that never arrived would hide an
  // alert it may carry. Only the server's `null` means no check has run.
  if (status === undefined) return null;
  if (status === null) {
    return (
      <Badge variant="slate" icon={ShieldQuestion} dot>
        {t('logs.integrity.statusUnchecked')}
      </Badge>
    );
  }
  if (status.alertActive) {
    return (
      <Badge variant="destructive" icon={ShieldAlert} dot>
        {t('logs.integrity.statusAlert')}
      </Badge>
    );
  }
  return (
    <Badge variant="green" icon={ShieldCheck} dot>
      {t('logs.integrity.statusOk')}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={1}>
      <Text as="span" variant="muted" className="text-xs font-medium">
        {label}
      </Text>
      <div className="text-foreground text-xs">{children}</div>
    </Stack>
  );
}
