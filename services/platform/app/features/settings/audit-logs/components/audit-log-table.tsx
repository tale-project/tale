'use client';

import type { UsePaginatedQueryResult } from 'convex/react';
import { useCallback, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useListPage } from '@/app/hooks/use-list-page';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useAuditLogTableConfig } from '../hooks/use-audit-log-table-config';

type AuditLog = Doc<'auditLogs'>;

interface AuditLogTableProps {
  paginatedResult: UsePaginatedQueryResult<AuditLog>;
  userEmailMap?: Map<string, string>;
}

export function AuditLogTable({
  paginatedResult,
  userEmailMap,
}: AuditLogTableProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('settings');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const resolveEmail = useCallback(
    (log: AuditLog) =>
      log.actorEmail || userEmailMap?.get(log.actorId) || undefined,
    [userEmailMap],
  );

  const { columns, stickyLayout, pageSize } = useAuditLogTableConfig({
    resolveEmail,
  });

  const list = useListPage<AuditLog>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
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
                value={resolveEmail(selectedLog) ?? selectedLog.actorId}
              />
              {resolveEmail(selectedLog) && (
                <DetailRow
                  label={t('logs.audit.columns.actorId')}
                  value={selectedLog.actorId}
                />
              )}
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
                  formatDate={formatDate}
                />
              )}
              {selectedLog.newState && (
                <DetailSection
                  label={t('logs.audit.columns.newState')}
                  data={selectedLog.newState}
                  formatDate={formatDate}
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
                    formatDate={formatDate}
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// Field-name suffixes that hint a value is a timestamp. Combined with a
// numeric/ISO-string check below this lets the JSON view render dates in a
// readable form instead of raw epoch ms — works for any audit log without
// per-action plumbing.
const TIMESTAMP_FIELD_SUFFIXES = ['at', 'until', 'time', 'timestamp'];

function looksLikeTimestampField(key: string): boolean {
  const lower = key.toLowerCase();
  return TIMESTAMP_FIELD_SUFFIXES.some((s) => lower.endsWith(s));
}

function tryFormatTimestamp(
  key: string,
  value: unknown,
  formatDate: (d: Date, preset?: 'short' | 'medium' | 'long') => string,
): string | null {
  if (!looksLikeTimestampField(key)) return null;
  if (typeof value === 'number' && value > 1e12 && Number.isFinite(value)) {
    return formatDate(new Date(value), 'long');
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return formatDate(new Date(parsed), 'long');
  }
  return null;
}

function formatMetadataValue(
  key: string,
  value: unknown,
  formatDate: (d: Date, preset?: 'short' | 'medium' | 'long') => string,
  indent: number,
): string {
  const friendly = tryFormatTimestamp(key, value, formatDate);
  if (friendly !== null) {
    const raw = typeof value === 'number' ? value : JSON.stringify(value);
    return `${friendly}  (${raw})`;
  }
  if (isPlainObject(value)) {
    return formatMetadataObject(value, formatDate, indent);
  }
  return JSON.stringify(value);
}

function formatMetadataObject(
  obj: Record<string, unknown>,
  formatDate: (d: Date, preset?: 'short' | 'medium' | 'long') => string,
  indent: number,
): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const lines = entries.map(
    ([k, v]) =>
      `${pad}"${k}": ${formatMetadataValue(k, v, formatDate, indent + 1)}`,
  );
  return `{\n${lines.join(',\n')}\n${closePad}}`;
}

function DetailSection({
  label,
  data,
  formatDate,
}: {
  label: string;
  data: Record<string, unknown>;
  formatDate: (d: Date, preset?: 'short' | 'medium' | 'long') => string;
}) {
  return (
    <Stack gap={2}>
      <Text as="span" variant="muted" className="font-medium">
        {label}
      </Text>
      <pre className="bg-muted/50 max-h-40 overflow-auto rounded-lg p-3 text-xs">
        {formatMetadataObject(data, formatDate, 0)}
      </pre>
    </Stack>
  );
}
