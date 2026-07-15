'use client';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * Compact inline pass/fail line shown next to a "Test connection" button.
 * Shared by the deployment-level and organization-level data-residency panels
 * so the probe feedback reads identically on both. The failed label is the
 * shared `settings.dataResidency.result.failed`; callers pass the success
 * wording (it differs per store: "OK", "Reachable", "Bucket verified", …).
 */
export function TestResultLine({
  result,
  okLabel,
}: {
  result?: { ok: boolean; message?: string };
  okLabel: string;
}) {
  const { t } = useT('settings');
  if (!result) return null;
  return (
    <span
      className={cn('text-sm', result.ok ? 'text-success' : 'text-destructive')}
    >
      {result.ok ? okLabel : t('dataResidency.result.failed')}
      {result.message ? ` — ${result.message}` : ''}
    </span>
  );
}
