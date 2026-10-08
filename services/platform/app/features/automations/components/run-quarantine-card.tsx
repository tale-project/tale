'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Text } from '@tale/ui/text';
import { useId, useRef, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import type { LegacyRunQuarantine } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { useRequestLegacyRunStop } from '../hooks/mutations';

interface HoldRef {
  runId: string;
  claimEpoch: number;
  observedAt: number;
}

function sameHold(a: HoldRef, b: HoldRef): boolean {
  return (
    a.runId === b.runId &&
    a.claimEpoch === b.claimEpoch &&
    a.observedAt === b.observedAt
  );
}

/** A stop request preserves the hold: it is not proof of a stopped session. */
export function RunQuarantineCard({
  organizationId,
  runId,
  quarantine,
  onReload,
  canRequestStop = true,
}: {
  organizationId: string;
  runId: string;
  quarantine: LegacyRunQuarantine | undefined;
  onReload: () => void;
  canRequestStop?: boolean;
}) {
  const { t } = useT('automations');
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const request = useRequestLegacyRunStop();
  const [confirming, setConfirming] = useState<HoldRef | null>(null);
  const [recorded, setRecorded] = useState<HoldRef | null>(null);
  const [refusal, setRefusal] = useState<{
    about: HoldRef;
    detail: string | undefined;
  } | null>(null);
  const current =
    quarantine === undefined
      ? null
      : {
          runId,
          claimEpoch: quarantine.claimEpoch,
          observedAt: quarantine.observedAt,
        };
  const requested =
    quarantine?.resolution?.action === 'stop' ||
    (current !== null && recorded !== null && sameHold(current, recorded));
  const unchanged =
    current !== null &&
    confirming !== null &&
    sameHold(current, confirming) &&
    !requested;
  const shownRefusal =
    current !== null && refusal !== null && sameHold(current, refusal.about)
      ? refusal
      : null;

  const confirm = () => {
    if (
      !canRequestStop ||
      !unchanged ||
      confirming === null ||
      request.isPending
    )
      return;
    const about = confirming;
    setRefusal(null);
    request
      .mutateAsync({
        organizationId,
        runId: about.runId,
        expectedClaimEpoch: about.claimEpoch,
        expectedObservedAt: about.observedAt,
        action: 'stop',
        acknowledgeUnknownExternalEffects: true,
      })
      .then(
        () => {
          setRecorded(about);
          setConfirming(null);
          onReload();
        },
        (error: unknown) => {
          setRefusal({ about, detail: failureDetail(error) });
          setConfirming(null);
          onReload();
        },
      );
  };

  return (
    <>
      <Card asChild padding="md">
        <section
          ref={sectionRef}
          aria-labelledby={titleId}
          tabIndex={-1}
          className="focus-visible:ring-ring flex flex-col gap-3 outline-none focus-visible:ring-2"
        >
          <Text as="h3" id={titleId} className="text-sm font-medium">
            {t('runs.quarantine.title')}
          </Text>
          <Text as="p" variant="muted">
            {t('runs.quarantine.body')}
          </Text>
          {requested ? (
            <Alert
              variant="info"
              description={t('runs.quarantine.requested')}
            />
          ) : current === null ? (
            <Alert variant="info" description={t('runs.quarantine.missing')} />
          ) : canRequestStop ? (
            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(current)}
              >
                {t('runs.quarantine.stop')}
              </Button>
            </div>
          ) : null}
          {shownRefusal !== null && (
            <Alert
              variant="destructive"
              description={[t('runs.quarantine.failed'), shownRefusal.detail]
                .filter(Boolean)
                .join(' ')}
            />
          )}
          {(current === null || shownRefusal !== null) && (
            <div>
              <Button variant="secondary" size="sm" onClick={onReload}>
                {t('runs.quarantine.reload')}
              </Button>
            </div>
          )}
        </section>
      </Card>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t('runs.quarantine.confirmTitle')}
        description={t('runs.quarantine.confirmBody')}
        confirmText={t('runs.quarantine.stop')}
        isLoading={request.isPending}
        disableConfirm={!unchanged || !canRequestStop}
        restoreFocusRef={sectionRef}
        onConfirm={confirm}
      >
        {confirming !== null && !unchanged && (
          <Alert variant="info" description={t('runs.quarantine.changed')} />
        )}
      </ConfirmDialog>
    </>
  );
}
