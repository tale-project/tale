import { CheckCircle2, Clock, Workflow } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

const ROWS = [
  { id: 'inventorySync', status: 'success', whenKey: 'justNow' },
  { id: 'customerEscalation', status: 'pending', whenKey: 'minutes14' },
  { id: 'complianceReport', status: 'success', whenKey: 'hour1' },
  { id: 'vendorSla', status: 'success', whenKey: 'hours4' },
] as const;

export function ProductMockOps() {
  const { t } = useT('productMockOps');

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--color-fg-base)]">
          <Workflow className="h-4 w-4" aria-hidden />
          {t('heading')}
        </div>
        <span className="text-xs text-[color:var(--color-fg-muted)]">
          {t('today')}
        </span>
      </div>

      <ul
        role="list"
        className="flex flex-col divide-y divide-[color:var(--color-border-base)] rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)]"
      >
        {ROWS.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
          >
            <div className="flex items-center gap-2 text-[color:var(--color-fg-base)]">
              {row.status === 'success' ? (
                <CheckCircle2
                  className="h-4 w-4 text-[color:var(--color-success)]"
                  aria-hidden
                />
              ) : (
                <Clock
                  className="h-4 w-4 text-[color:var(--color-warning)]"
                  aria-hidden
                />
              )}
              {t(`rows.${row.id}`)}
            </div>
            <span className="text-xs text-[color:var(--color-fg-muted)]">
              {t(`when.${row.whenKey}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
