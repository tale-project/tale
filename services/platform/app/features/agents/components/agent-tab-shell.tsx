'use client';

import { Alert } from '@tale/ui/alert';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The three states every agent editor tab shares: loading skeleton, a
 * not-found/error alert, and — once the document is there — the tab's own
 * form. Keeps the per-tab components to just their fields.
 */
export function AgentTabShell({
  isPending,
  isError,
  missing,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  /** True when the query resolved to null (no such agent for this viewer). */
  missing: boolean;
  children: ReactNode;
}) {
  const { t } = useT('settings');

  if (isPending) {
    return (
      <Skeletonize loading>
        <SkeletonBox fullWidth>
          <div className="h-72 w-full rounded-lg" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (isError || missing) {
    return (
      <Alert
        variant="destructive"
        description={
          isError ? t('agents.listFailed') : t('agents.agentNotFound')
        }
      />
    );
  }

  return <>{children}</>;
}
