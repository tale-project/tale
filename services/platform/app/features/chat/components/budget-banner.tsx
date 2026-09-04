'use client';

/**
 * The usage-budget strip above the composer.
 *
 * While the caller approaches a governance budget it shows what is LEFT —
 * dismissible, warning tint. Once a limit is exceeded it hardens: the line
 * says the limit is reached and when it resets, it can no longer be
 * dismissed (a hard block is never hidden — it also shows regardless of the
 * team filter), and a "Request usage credits" affordance notifies the org's
 * operators through the notification bell.
 */

import { AlertTriangle, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { requestUsageCreditsRequest } from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMyBudgetStatus } from '../../settings/governance/hooks/queries';

function formatAmount(code: string, value: number): string {
  return code.startsWith('COST')
    ? `$${(value / 100).toFixed(2)}`
    : value.toLocaleString();
}

export function BudgetBanner({ organizationId }: { organizationId: string }) {
  const { t } = useT('chat');
  const teamFilter = useOptionalTeamFilter();
  const { data: budgetStatus } = useMyBudgetStatus(
    organizationId,
    teamFilter?.selectedTeamId,
  );
  // Derive a stable key so dismissed state resets only when the status meaningfully changes,
  // not on every Convex subscription tick (which creates new object references).
  const budgetStatusKey = useMemo(
    () =>
      budgetStatus
        ? `${budgetStatus.exceeded}-${budgetStatus.code}-${budgetStatus.period}-${budgetStatus.warnings?.map((w) => `${w.scope ?? 'user'}:${w.code}:${w.percent}`).join(',')}`
        : null,
    [budgetStatus],
  );
  const [dismissed, setDismissed] = useState(false);
  const [prevKey, setPrevKey] = useState(budgetStatusKey);
  const [requested, setRequested] = useState(false);

  if (budgetStatusKey !== prevKey) {
    setPrevKey(budgetStatusKey);
    setDismissed(false);
  }

  if (!budgetStatus) return null;
  const exceeded = budgetStatus.exceeded;
  if (!exceeded && (dismissed || !budgetStatus.warnings?.length)) return null;

  const requestCredits = () => {
    if (requested) return;
    setRequested(true);
    requestUsageCreditsRequest(organizationId)
      .then((sent) => {
        if (sent) {
          toast({ title: t('budgetRequestCreditsSent') });
        } else {
          setRequested(false);
        }
      })
      .catch((error: unknown) => {
        console.error('[chat] credit request failed', error);
        setRequested(false);
      });
  };

  const typeLabel = (code: string) =>
    code.startsWith('COST')
      ? t('budgetWarningTypeCost')
      : code.startsWith('TOKEN')
        ? t('budgetWarningTypeTokens')
        : t('budgetWarningTypeRequests');

  const detail =
    exceeded && budgetStatus.used != null && budgetStatus.limit != null
      ? t('budgetExceededDetail', {
          type: typeLabel(budgetStatus.code ?? ''),
          period: budgetStatus.period ?? 'monthly',
          used: formatAmount(budgetStatus.code ?? '', budgetStatus.used),
          limit: formatAmount(budgetStatus.code ?? '', budgetStatus.limit),
        })
      : t('budgetExceededDefault');

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2',
        exceeded
          ? 'bg-destructive/10 border-destructive/30'
          : 'bg-warning/10 border-warning/30',
      )}
    >
      <AlertTriangle
        className={cn(
          'size-4 shrink-0',
          exceeded ? 'text-destructive' : 'text-warning',
        )}
      />
      <span
        {...(exceeded ? { title: detail } : {})}
        className={cn(
          'flex-1 truncate text-sm',
          exceeded ? 'text-destructive' : 'text-foreground',
        )}
      >
        {exceeded
          ? t('budgetLimitReached', {
              period: budgetStatus.period ?? 'monthly',
            })
          : budgetStatus.warnings
              ?.map((w) => {
                const values = {
                  remaining: formatAmount(
                    w.code,
                    Math.max(0, w.limit - w.used),
                  ),
                  limit: formatAmount(w.code, w.limit),
                  type: typeLabel(w.code),
                  period: w.period,
                };
                // An org-bucket warning is about the organization's whole
                // spend, not the reader's — say so, or "left" reads as theirs.
                return w.scope === 'org'
                  ? t('budgetRemainingOrg', values)
                  : t('budgetRemaining', values);
              })
              .join(' · ')}
      </span>
      {exceeded ? (
        <button
          type="button"
          onClick={requestCredits}
          disabled={requested}
          className="text-foreground shrink-0 text-sm underline underline-offset-2 disabled:no-underline disabled:opacity-60"
        >
          {requested
            ? t('budgetRequestCreditsSent')
            : t('budgetRequestCredits')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label={t('budgetWarningDismiss')}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
