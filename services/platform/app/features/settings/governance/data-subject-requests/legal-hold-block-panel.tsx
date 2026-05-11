'use client';

import { Link } from '@tanstack/react-router';
import { AlertOctagon } from 'lucide-react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useGetErasureRequest } from './hooks/queries';

interface LegalHoldBlockPanelProps {
  organizationId: string;
  requestId: Id<'gdprErasureRequests'>;
}

/**
 * Inline panel surfaced when `requestErasure` rejects with
 * `LEGAL_HOLD_BLOCKS_ERASURE`. The receipt row is inserted *before* the
 * hold gate, so we hydrate the full block context (held thread / doc
 * ids, scope flags) via `getErasureRequest(requestId)` rather than
 * relying solely on the error payload.
 *
 * Each held id deep-links to the legal-hold page so the admin can
 * decide whether to release the hold and retry the erasure.
 */
export function LegalHoldBlockPanel({
  organizationId,
  requestId,
}: LegalHoldBlockPanelProps) {
  const { t } = useT('governance');
  const { data, isLoading } = useGetErasureRequest(requestId);

  if (isLoading || !data) return null;
  const { request } = data;
  const heldThreads = request.threadsBlockedByHold ?? [];
  const heldDocs = request.documentsBlockedByHold ?? [];
  const orgHeld = request.errorMessage === 'org_hold';
  const userCustodianHeld = request.errorMessage === 'user_custodian_hold';

  return (
    <div
      // `role="alert"` already implies `aria-live="assertive"`; an
      // explicit `aria-live="polite"` here was contradictory and
      // browser-defined. The panel is informational (not an interrupt),
      // so prefer `role="status"` (polite by default).
      role="status"
      className="border-destructive/40 bg-destructive/5 flex flex-col gap-3 rounded-md border p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <AlertOctagon
          className="text-destructive mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          {/* Title uses `text-foreground` so contrast clears AA against
              the tinted destructive background. The icon above carries
              the destructive hue for visual emphasis. */}
          <span className="text-foreground font-medium">
            {t('dataSubjectRequests.legalHoldBlock.title')}
          </span>
          <span className="text-foreground/80">
            {orgHeld
              ? t('dataSubjectRequests.legalHoldBlock.orgHeld')
              : userCustodianHeld
                ? t('dataSubjectRequests.legalHoldBlock.userCustodianHeld')
                : t('dataSubjectRequests.legalHoldBlock.generic')}
          </span>
        </div>
      </div>

      {(heldThreads.length > 0 || heldDocs.length > 0) && (
        <div className="text-foreground/80 flex flex-col gap-1 text-xs">
          {heldThreads.length > 0 && (
            <span>
              {t('dataSubjectRequests.legalHoldBlock.threadsCount', {
                count: heldThreads.length,
              })}
            </span>
          )}
          {heldDocs.length > 0 && (
            <span>
              {t('dataSubjectRequests.legalHoldBlock.documentsCount', {
                count: heldDocs.length,
              })}
            </span>
          )}
        </div>
      )}

      <Link
        to="/dashboard/$id/settings/governance/legal-hold"
        params={{ id: organizationId }}
        className="text-primary text-xs underline underline-offset-2"
        aria-label={t('dataSubjectRequests.legalHoldBlock.openLegalHoldAria')}
      >
        {t('dataSubjectRequests.legalHoldBlock.openLegalHold')}
      </Link>
    </div>
  );
}
