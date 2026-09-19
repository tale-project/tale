'use client';

/**
 * The usage-budget banner above the composer.
 *
 * While the caller approaches a governance budget it shows what is LEFT —
 * dismissible, warning tint. Once a limit is exceeded it hardens: the line
 * says the limit is reached and when it resets, it can no longer be
 * dismissed (a hard block is never hidden — it also shows regardless of the
 * team filter), and a "Request usage credits" affordance notifies the org's
 * operators through the notification bell. Either state links to the
 * member's usage page, where every cap that binds them reads in full.
 *
 * It is an `Alert` in the composer's own column. The strip once lived under
 * the page header, which is why it used to span the pane with a bare bottom
 * border; here the tint, the coloured glyph and the live region come from
 * the design system, and the copy stays foreground — red-on-pink fails AA
 * contrast in light mode, and the accent belongs on the fill and the icon,
 * not on the words.
 */

import { Alert } from '@tale/ui/alert';
import { Row } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { requestUsageCreditsRequest } from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';

import { useMyBudgetStatus } from '../../settings/governance/hooks/queries';

function formatAmount(code: string, value: number): string {
  return code.startsWith('COST')
    ? `$${(value / 100).toFixed(2)}`
    : value.toLocaleString();
}

export function BudgetBanner({ organizationId }: { organizationId: string }) {
  const { t } = useT('chat');
  // The reader's whole standing — every cap that binds them (their own,
  // each team's shared cap, the organization's), as the gate measures it.
  const { data: budgetStatus } = useMyBudgetStatus(organizationId);
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

  const message = exceeded
    ? t('budgetLimitReached', {
        period: budgetStatus.period ?? 'monthly',
      })
    : budgetStatus.warnings
        ?.map((w) => {
          const values = {
            remaining: formatAmount(w.code, Math.max(0, w.limit - w.used)),
            limit: formatAmount(w.code, w.limit),
            type: typeLabel(w.code),
            period: w.period,
          };
          // An org- or team-bucket warning is about a shared spend, not the
          // reader's own — say whose, or "left" reads as theirs.
          if (w.scope === 'org') return t('budgetRemainingOrg', values);
          if (w.scope === 'team') {
            return t('budgetRemainingTeam', {
              ...values,
              team: w.teamName ?? '',
            });
          }
          return t('budgetRemaining', values);
        })
        .join(' · ');

  return (
    <Alert
      variant={exceeded ? 'destructive' : 'warning'}
      className="mx-auto mb-2 w-full max-w-3xl"
    >
      <Row gap={2}>
        <span
          {...(exceeded ? { title: detail } : {})}
          className="text-foreground min-w-0 flex-1 truncate text-sm"
        >
          {message}
        </span>
        <Link
          to="/dashboard/$id/settings/usage"
          params={{ id: organizationId }}
          className="text-foreground shrink-0 text-sm underline underline-offset-2"
        >
          {t('budgetViewUsage')}
        </Link>
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
      </Row>
    </Alert>
  );
}
