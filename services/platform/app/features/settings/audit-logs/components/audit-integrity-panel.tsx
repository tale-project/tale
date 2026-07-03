'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { InlineCode } from '@tale/ui/inline-code';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { useCallback, type ReactNode } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
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
  const checkpointMismatch =
    result && !result.valid ? result.checkpointMismatch : undefined;
  const brokenWithoutRow = result !== undefined && !result.valid && !brokenAt;

  return (
    <BorderedSection aria-label={t('logs.integrity.title')}>
      <Row className="items-start justify-between gap-3">
        <Stack gap={1} className="min-w-0">
          <Row gap={2} className="flex-wrap items-center">
            <Text as="span" className="text-foreground text-sm font-medium">
              {t('logs.integrity.title')}
            </Text>
            <StatusBadge status={s} loading={status.isLoading} t={t} />
          </Row>
          <Stack gap={1}>
            <Text as="span" variant="muted" className="text-xs">
              {s == null
                ? t('logs.integrity.neverChecked')
                : t('logs.integrity.lastCheck', {
                    date: formatDate(new Date(s.updatedAt), 'long'),
                  })}
            </Text>
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

      {brokenWithoutRow && (
        <Alert
          variant="destructive"
          icon={ShieldAlert}
          live="assertive"
          title={t('logs.integrity.checkpointTitle')}
        >
          <Stack gap={2}>
            {checkpointMismatch ? (
              <>
                <Field label={t('logs.integrity.checkpointId')}>
                  <InlineCode className="break-all">
                    {checkpointMismatch.checkpointId}
                  </InlineCode>
                </Field>
                <Field label={t('logs.integrity.reason')}>
                  {checkpointMismatch.reason}
                </Field>
              </>
            ) : (
              <Text as="span" variant="muted" className="text-sm">
                {t('logs.integrity.brokenBody')}
              </Text>
            )}
          </Stack>
        </Alert>
      )}
    </BorderedSection>
  );
}

function StatusBadge({
  status,
  loading,
  t,
}: {
  status: IntegrityStatus | undefined;
  loading: boolean;
  t: (key: string) => string;
}) {
  // While the first read is in flight, render nothing rather than flashing a
  // misleading "not yet checked".
  if (status === undefined) {
    return loading ? null : (
      <Badge variant="slate" icon={ShieldQuestion} dot>
        {t('logs.integrity.statusUnchecked')}
      </Badge>
    );
  }
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
