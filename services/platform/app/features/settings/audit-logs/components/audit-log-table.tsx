'use client';

import { useNavigate } from '@tanstack/react-router';
import type { UsePaginatedQueryResult } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useListPage } from '@/app/hooks/use-list-page';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useAuditLogTableConfig } from '../hooks/use-audit-log-table-config';

type AuditLog = Doc<'auditLogs'>;

interface AuditLogTableProps {
  organizationId: string;
  paginatedResult: UsePaginatedQueryResult<AuditLog>;
  category?: string;
  isAdmin?: boolean;
}

export function AuditLogTable({
  organizationId,
  paginatedResult,
  category,
  isAdmin: isAdminUser = false,
}: AuditLogTableProps) {
  const navigate = useNavigate();
  const { formatDate } = useFormatDate();
  const { t } = useT('settings');
  const { toast } = useToast();
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const { columns, stickyLayout, pageSize } = useAuditLogTableConfig();

  const exportAction = useConvexAction(api.audit_logs.actions.requestExport, {
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
      toast({
        title: t('logs.audit.export.complete'),
        description: data.fileName,
      });
    },
    onError: () => {
      toast({
        title: t('logs.audit.export.error'),
        variant: 'destructive',
      });
    },
  });

  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      exportAction.mutate({
        organizationId,
        format,
        filter: category ? { category } : undefined,
      });
    },
    [organizationId, category, exportAction],
  );

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
          { value: 'ai', label: t('logs.audit.categories.ai') },
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
      {isAdminUser && (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport('csv')}
            disabled={exportAction.isPending}
            aria-label={t('logs.audit.export.csvLabel')}
          >
            {exportAction.isPending
              ? t('logs.audit.export.inProgress')
              : t('logs.audit.export.csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport('json')}
            disabled={exportAction.isPending}
            aria-label={t('logs.audit.export.jsonLabel')}
          >
            {exportAction.isPending
              ? t('logs.audit.export.inProgress')
              : t('logs.audit.export.json')}
          </Button>
        </div>
      )}

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
            <Stack gap={4} className="pr-4">
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
              {selectedLog.category === 'ai' && selectedLog.metadata ? (
                <AiMetadataSection metadata={selectedLog.metadata} t={t} />
              ) : (
                selectedLog.metadata &&
                Object.keys(selectedLog.metadata).length > 0 && (
                  <DetailSection
                    label={t('logs.audit.columns.metadata')}
                    data={selectedLog.metadata}
                  />
                )
              )}
            </Stack>
          </div>
        )}
      </Dialog>
    </>
  );
}

function toDisplayString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return `${val}`;
  return JSON.stringify(val);
}

function AiMetadataSection({
  metadata,
  t,
}: {
  metadata: Record<string, unknown>;
  t: (key: string) => string;
}) {
  const toolNames = Array.isArray(metadata.toolNames)
    ? metadata.toolNames.filter((n): n is string => typeof n === 'string')
    : [];

  return (
    <Stack gap={2}>
      <Text as="span" variant="muted" className="font-medium">
        {t('logs.audit.aiMetadata.title')}
      </Text>
      <div className="bg-muted/50 rounded-lg p-3">
        <Stack gap={2}>
          {metadata.model != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.model')}
              value={toDisplayString(metadata.model)}
            />
          )}
          {metadata.provider != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.provider')}
              value={toDisplayString(metadata.provider)}
            />
          )}
          {metadata.inputTokens != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.inputTokens')}
              value={toDisplayString(metadata.inputTokens)}
            />
          )}
          {metadata.outputTokens != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.outputTokens')}
              value={toDisplayString(metadata.outputTokens)}
            />
          )}
          {metadata.totalTokens != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.totalTokens')}
              value={toDisplayString(metadata.totalTokens)}
            />
          )}
          {typeof metadata.costEstimateCents === 'number' && (
            <DetailRow
              label={t('logs.audit.aiMetadata.cost')}
              value={`$${(metadata.costEstimateCents / 100).toFixed(4)}`}
            />
          )}
          {typeof metadata.durationMs === 'number' && (
            <DetailRow
              label={t('logs.audit.aiMetadata.duration')}
              value={`${metadata.durationMs.toLocaleString()} ms`}
            />
          )}
          {metadata.agentSlug != null && (
            <DetailRow
              label={t('logs.audit.aiMetadata.agent')}
              value={toDisplayString(metadata.agentSlug)}
            />
          )}
          {toolNames.length > 0 && (
            <DetailRow
              label={t('logs.audit.aiMetadata.tools')}
              value={toolNames.join(', ')}
            />
          )}
        </Stack>
      </div>
    </Stack>
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
      <Text as="span" variant="muted" className="font-medium">
        {label}
      </Text>
      <Text
        as="span"
        variant="body"
        className={cn('col-span-2 capitalize', isError && 'text-destructive')}
      >
        {value}
      </Text>
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
    <Stack gap={2}>
      <Text as="span" variant="muted" className="font-medium">
        {label}
      </Text>
      <pre className="bg-muted/50 max-h-40 overflow-auto rounded-lg p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </Stack>
  );
}
