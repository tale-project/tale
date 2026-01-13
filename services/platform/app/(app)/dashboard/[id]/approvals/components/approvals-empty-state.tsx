'use client';

import { GitCompare } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

interface ApprovalsEmptyStateProps {
  status: string;
}

/**
 * Client-side empty state component for approvals.
 * This must be a client component because it passes an icon (forwardRef component)
 * to DataTableEmptyState, which cannot be serialized from Server to Client Components.
 */
export function ApprovalsEmptyState({ status }: ApprovalsEmptyStateProps) {
  const { t } = useT('approvals');

  return (
    <DataTableEmptyState
      icon={GitCompare}
      title={t(`emptyState.${status}.title` as any)}
      description={
        status === 'pending'
          ? t('emptyState.pending.description' as any)
          : undefined
      }
    />
  );
}
