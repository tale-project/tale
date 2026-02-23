'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useAuditLogTableConfig } from '../hooks/use-audit-log-table-config';

type AuditLog = Doc<'auditLogs'>;

interface AuditLogTableProps {
  organizationId: string;
  paginatedResult: UsePaginatedQueryResult<AuditLog>;
  category?: string;
}

export function AuditLogTable({
  organizationId,
  paginatedResult,
  category,
}: AuditLogTableProps) {
  const navigate = useNavigate();
  const { formatDate } = useFormatDate();
  const { t } = useT('settings');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const { columns, stickyLayout, pageSize } = useAuditLogTableConfig();

  const handleCategoryChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/settings/logs',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          category: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleClearFilters = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/settings/logs',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

  const filterConfigs = useMemo(
    () => [
      {
        key: 'category',
        title: t('logs.audit.columns.category'),
        options: [
          { value: 'auth', label: t('logs.audit.categories.auth') },
          { value: 'member', label: t('logs.audit.categories.member') },
          { value: 'data', label: t('logs.audit.categories.data') },
          {
            value: 'integration',
            label: t('logs.audit.categories.integration'),
          },
          { value: 'workflow', label: t('logs.audit.categories.workflow') },
          { value: 'security', label: t('logs.audit.categories.security') },
          { value: 'admin', label: t('logs.audit.categories.admin') },
        ],
        selectedValues: category ? [category] : [],
        onChange: handleCategoryChange,
      },
    ],
    [category, t, handleCategoryChange],
  );

  const list = useListPage<AuditLog>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
  });

  return (
    <>
      <DataTable
        columns={columns}
        caption={t('logs.audit.tableCaption')}
        stickyLayout={stickyLayout}
        emptyState={{
          title: t('logs.audit.emptyTitle'),
          description: t('logs.audit.emptyDescription'),
        }}
        onRowClick={(row) => setSelectedLog(row.original)}
        clickableRows
        {...list.tableProps}
      />

      <Dialog
        open={!!selectedLog}
        onOpenChange={() => setSelectedLog(null)}
        title={t('logs.audit.detailTitle')}
        className="max-w-2xl"
      >
        {selectedLog && (
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="space-y-4 pr-4">
              <DetailRow
                label={t('logs.audit.columns.timestamp')}
                value={formatDate(new Date(selectedLog.timestamp), 'long')}
              />
              <DetailRow
                label={t('logs.audit.columns.action')}
                value={selectedLog.action.replace(/_/g, ' ')}
              />
              <DetailRow
                label={t('logs.audit.columns.actor')}
                value={selectedLog.actorEmail ?? selectedLog.actorId}
              />
              <DetailRow
                label={t('logs.audit.columns.actorType')}
                value={selectedLog.actorType}
              />
              {selectedLog.actorRole && (
                <DetailRow
                  label={t('logs.audit.columns.actorRole')}
                  value={selectedLog.actorRole}
                />
              )}
              <DetailRow
                label={t('logs.audit.columns.category')}
                value={selectedLog.category}
              />
              <DetailRow
                label={t('logs.audit.columns.resource')}
                value={selectedLog.resourceType}
              />
              {selectedLog.resourceId && (
                <DetailRow
                  label={t('logs.audit.columns.resourceId')}
                  value={selectedLog.resourceId}
                />
              )}
              {selectedLog.resourceName && (
                <DetailRow
                  label={t('logs.audit.columns.target')}
                  value={selectedLog.resourceName}
                />
              )}
              <DetailRow
                label={t('logs.audit.columns.status')}
                value={selectedLog.status}
              />
              {selectedLog.errorMessage && (
                <DetailRow
                  label={t('logs.audit.columns.error')}
                  value={selectedLog.errorMessage}
                  isError
                />
              )}
              {selectedLog.changedFields &&
                selectedLog.changedFields.length > 0 && (
                  <DetailRow
                    label={t('logs.audit.columns.changedFields')}
                    value={selectedLog.changedFields.join(', ')}
                  />
                )}
              {selectedLog.previousState && (
                <DetailSection
                  label={t('logs.audit.columns.previousState')}
                  data={selectedLog.previousState}
                />
              )}
              {selectedLog.newState && (
                <DetailSection
                  label={t('logs.audit.columns.newState')}
                  data={selectedLog.newState}
                />
              )}
              {selectedLog.metadata &&
                Object.keys(selectedLog.metadata).length > 0 && (
                  <DetailSection
                    label={t('logs.audit.columns.metadata')}
                    data={selectedLog.metadata}
                  />
                )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function DetailRow({
  label,
  value,
  isError = false,
}: {
  label: string;
  value: string;
  isError?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span
        className={cn(
          'col-span-2 text-sm capitalize',
          isError && 'text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DetailSection({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown>;
}) {
  return (
    <div className="space-y-2">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <pre className="bg-muted/50 max-h-40 overflow-auto rounded-lg p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
