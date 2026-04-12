'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMyBudgetStatus } from '../../settings/governance/hooks/queries';

export function BudgetBanner({ organizationId }: { organizationId: string }) {
  const { t } = useT('chat');
  const { data: budgetStatus } = useMyBudgetStatus(organizationId);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when budget status changes (e.g. new period or threshold crossed)
  useEffect(() => {
    setDismissed(false);
  }, [budgetStatus]);

  if (!budgetStatus || dismissed) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2',
        budgetStatus.exceeded
          ? 'bg-destructive/10 border-destructive/30'
          : 'bg-warning/10 border-warning/30',
      )}
    >
      <AlertTriangle
        className={cn(
          'size-4 shrink-0',
          budgetStatus.exceeded ? 'text-destructive' : 'text-warning',
        )}
      />
      <span
        className={cn(
          'flex-1 text-sm',
          budgetStatus.exceeded ? 'text-destructive' : 'text-foreground',
        )}
      >
        {budgetStatus.exceeded
          ? (() => {
              const isCost = budgetStatus.code === 'COST_LIMIT';
              const used =
                isCost && budgetStatus.used != null
                  ? `$${(budgetStatus.used / 100).toFixed(2)}`
                  : budgetStatus.used?.toLocaleString();
              const limit =
                isCost && budgetStatus.limit != null
                  ? `$${(budgetStatus.limit / 100).toFixed(2)}`
                  : budgetStatus.limit?.toLocaleString();
              const type = isCost
                ? t('budgetWarningTypeCost')
                : budgetStatus.code === 'TOKEN_LIMIT'
                  ? t('budgetWarningTypeTokens')
                  : t('budgetWarningTypeRequests');
              return used != null && limit != null
                ? t('budgetExceededDetail', {
                    type,
                    period: budgetStatus.period ?? 'monthly',
                    used,
                    limit,
                  })
                : t('budgetExceededDefault');
            })()
          : budgetStatus.warnings
              ?.map((w) => {
                const type =
                  w.code === 'TOKEN_WARNING'
                    ? t('budgetWarningTypeTokens')
                    : w.code === 'COST_WARNING'
                      ? t('budgetWarningTypeCost')
                      : t('budgetWarningTypeRequests');
                const used =
                  w.code === 'COST_WARNING'
                    ? `$${(w.used / 100).toFixed(2)}`
                    : w.used.toLocaleString();
                const limit =
                  w.code === 'COST_WARNING'
                    ? `$${(w.limit / 100).toFixed(2)}`
                    : w.limit.toLocaleString();
                return t('budgetWarning', {
                  percent: w.percent,
                  period: w.period,
                  type,
                  used,
                  limit,
                });
              })
              .join(' · ')}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label={t('budgetWarningDismiss')}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
