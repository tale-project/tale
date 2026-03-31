'use client';

import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import type { Integration } from '../hooks/use-integration-manage';

import { IntegrationRelatedAutomations } from './integration-manage/integration-related-automations';

interface IntegrationDetailsProps {
  integration: Integration;
  connectorCodeLoading?: boolean;
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Section row — matches design: label + optional badge + chevron
// ---------------------------------------------------------------------------

function SectionRow({
  label,
  badge,
  expanded,
  onToggle,
  isLast,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3"
      >
        <span className="text-foreground text-[13px] leading-tight font-medium tracking-[-0.078px]">
          {label}
        </span>
        {badge && <span className="inline-flex">{badge}</span>}
        <span className="text-muted-foreground ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </span>
      </button>
      {expanded && children}
      {!isLast && <div className="bg-border h-px w-full" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Copy button inside expanded content area
// ---------------------------------------------------------------------------

function ContentCopyButton({ value }: { value: string }) {
  const { t: tCommon } = useT('common');
  const { copied, onClick } = useCopyButton(value);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="hover:bg-foreground/5 mb-auto shrink-0 cursor-pointer rounded p-0.5 transition-colors"
      aria-label={tCommon('actions.copy')}
    >
      {copied ? (
        <Check className="text-muted-foreground size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="text-muted-foreground size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

function SqlQueryCopyButton({ query }: { query: string }) {
  const { t: tCommon } = useT('common');
  const { copied, onClick } = useCopyButton(query);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="hover:bg-foreground/5 ml-auto shrink-0 cursor-pointer rounded p-0.5 transition-colors"
      aria-label={tCommon('actions.copy')}
    >
      {copied ? (
        <Check
          className="size-3 text-green-600 dark:text-green-400"
          aria-hidden="true"
        />
      ) : (
        <Copy className="text-muted-foreground size-3" aria-hidden="true" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Parameters (nested collapsible inside an operation)
// ---------------------------------------------------------------------------

interface ParameterInfo {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

function extractParameters(
  schema: Record<string, unknown> | undefined,
): ParameterInfo[] {
  if (!schema) return [];
  const properties = schema.properties;
  if (!isRecord(properties)) return [];
  return Object.entries(properties)
    .filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    )
    .map(([name, def]) => ({
      name,
      type: [def.type, def.format].filter(Boolean).join(':'),
      description:
        typeof def.description === 'string' ? def.description : undefined,
      required: def.required === true,
    }));
}

function ParametersDisplay({
  schema,
  t,
}: {
  schema: Record<string, unknown> | undefined;
  t: (key: string) => string;
}) {
  const params = useMemo(() => extractParameters(schema), [schema]);
  if (params.length === 0) return null;

  return (
    <details className="group/params mt-1">
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs font-medium select-none">
        <ChevronRight
          className="size-3 shrink-0 transition-transform group-open/params:rotate-90"
          aria-hidden
        />
        {t('integrations.manageDialog.parameters')}
        <Badge variant="outline" className="text-[10px] leading-tight">
          {params.length}
        </Badge>
      </summary>
      <dl className="bg-background mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded border p-2 text-xs">
        {params.map((param) => (
          <div key={param.name} className="col-span-2 grid grid-cols-subgrid">
            <dt className="flex items-center gap-1.5">
              <code className="font-mono">{param.name}</code>
              <Text as="span" variant="caption">
                {param.type}
              </Text>
              {param.required && (
                <Badge variant="orange" className="text-[10px] leading-tight">
                  {t('integrations.manageDialog.required')}
                </Badge>
              )}
            </dt>
            {param.description && (
              <dd className="text-muted-foreground truncate">
                {param.description}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IntegrationDetails({
  integration,
  connectorCodeLoading,
  children,
}: IntegrationDetailsProps) {
  const { t } = useT('settings');

  const restOperations = useMemo(
    () => integration.connector?.operations ?? integration.operations ?? [],
    [integration.connector, integration.operations],
  );

  const sqlOperations = useMemo(
    () => integration.sqlOperations ?? [],
    [integration.sqlOperations],
  );

  const allowedHosts = useMemo(
    () => integration.connector?.allowedHosts ?? integration.allowedHosts ?? [],
    [integration.connector, integration.allowedHosts],
  );

  const connectorCode = integration.connector?.code ?? '';
  const isSql = integration.type === 'sql';

  const trimmedCode = connectorCode.trim();
  const lineCount = trimmedCode.length > 0 ? trimmedCode.split('\n').length : 0;

  const operationsSummary = useMemo(
    () =>
      restOperations
        .map((op) => (op.title ? `${op.name} — ${op.title}` : op.name))
        .join('\n'),
    [restOperations],
  );

  const sqlOperationsSummary = useMemo(
    () =>
      sqlOperations
        .map((op) => {
          const header = op.title ? `${op.name} — ${op.title}` : op.name;
          return `${header}\n${op.query}`;
        })
        .join('\n\n'),
    [sqlOperations],
  );

  const sqlConfigItems = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('integrations.upload.engine'),
        value: (
          <span className="font-mono">
            {integration.sqlConnectionConfig?.engine}
          </span>
        ),
      },
      ...(integration.sqlConnectionConfig?.port != null
        ? [
            {
              label: t('integrations.upload.port'),
              value: (
                <span className="font-mono">
                  {integration.sqlConnectionConfig.port}
                </span>
              ),
            },
          ]
        : []),
      ...(integration.sqlConnectionConfig?.readOnly != null
        ? [
            {
              label: t('integrations.upload.readOnly'),
              value: integration.sqlConnectionConfig.readOnly ? 'Yes' : 'No',
            },
          ]
        : []),
      ...(integration.sqlConnectionConfig?.security?.maxResultRows != null
        ? [
            {
              label: t('integrations.upload.maxResultRows'),
              value: (
                <span className="font-mono">
                  {integration.sqlConnectionConfig.security.maxResultRows}
                </span>
              ),
            },
          ]
        : []),
      ...(integration.sqlConnectionConfig?.security?.queryTimeoutMs != null
        ? [
            {
              label: t('integrations.upload.queryTimeout'),
              value: (
                <span className="font-mono">
                  {integration.sqlConnectionConfig.security.queryTimeoutMs}
                </span>
              ),
            },
          ]
        : []),
    ],
    [integration.sqlConnectionConfig, t],
  );

  // Build the list of visible sections
  const sections: string[] = [];
  if (restOperations.length > 0) sections.push('operations');
  if (sqlOperations.length > 0) sections.push('sqlOperations');
  if (isSql && integration.isActive && integration.sqlConnectionConfig)
    sections.push('sqlConfig');
  if (allowedHosts.length > 0) sections.push('allowedHosts');
  if (!isSql && (lineCount > 0 || connectorCodeLoading))
    sections.push('connectorCode');
  sections.push('automations');
  if (children) sections.push('update');

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (sections.length === 0) return null;

  const lastSection = sections[sections.length - 1];

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      {restOperations.length > 0 && (
        <SectionRow
          label={t('integrations.upload.operations')}
          badge={
            <Badge variant="outline" className="text-xs">
              {restOperations.length}
            </Badge>
          }
          expanded={expanded.has('operations')}
          onToggle={() => toggle('operations')}
          isLast={lastSection === 'operations'}
        >
          <div className="border-border bg-muted flex gap-3 border-x px-4 py-3">
            <ul
              className="max-h-48 flex-1 space-y-1.5 overflow-y-auto text-sm"
              role="list"
            >
              {restOperations.map((op) => (
                <li key={op.name} className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <Text as="span" variant="code" truncate>
                      {op.name}
                    </Text>
                    {op.title && (
                      <Text as="span" variant="caption" className="shrink-0">
                        — {op.title}
                      </Text>
                    )}
                  </div>
                  {op.description && (
                    <Text variant="caption">{op.description}</Text>
                  )}
                  <ParametersDisplay schema={op.parametersSchema} t={t} />
                </li>
              ))}
            </ul>
            <ContentCopyButton value={operationsSummary} />
          </div>
        </SectionRow>
      )}

      {sqlOperations.length > 0 && (
        <SectionRow
          label={t('integrations.manageDialog.sqlOperations')}
          badge={
            <Badge variant="outline" className="text-xs">
              {sqlOperations.length}
            </Badge>
          }
          expanded={expanded.has('sqlOperations')}
          onToggle={() => toggle('sqlOperations')}
          isLast={lastSection === 'sqlOperations'}
        >
          <div className="border-border bg-muted flex gap-3 border-x px-4 py-3">
            <ul
              className="max-h-60 flex-1 space-y-2 overflow-y-auto text-sm"
              role="list"
            >
              {sqlOperations.map((op) => (
                <li key={op.name}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Text as="span" variant="code" truncate>
                      {op.name}
                    </Text>
                    {op.title && (
                      <Text as="span" variant="caption" className="shrink-0">
                        — {op.title}
                      </Text>
                    )}
                    {op.operationType === 'write' && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {t('integrations.upload.write')}
                      </Badge>
                    )}
                    {op.requiresApproval && (
                      <Badge variant="orange" className="shrink-0 text-xs">
                        {t('integrations.manageDialog.requiresApproval')}
                      </Badge>
                    )}
                  </div>
                  {op.description && (
                    <Text variant="caption" className="mt-0.5">
                      {op.description}
                    </Text>
                  )}
                  <details className="group/sql mt-1">
                    <summary className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs font-medium select-none">
                      <ChevronRight
                        className="size-3 shrink-0 transition-transform group-open/sql:rotate-90"
                        aria-hidden
                      />
                      {t('integrations.manageDialog.query')}
                      <SqlQueryCopyButton query={op.query} />
                    </summary>
                    <pre className="bg-background mt-1 max-h-32 overflow-y-auto rounded border p-2 text-xs break-words whitespace-pre-wrap">
                      {op.query}
                    </pre>
                  </details>
                  <ParametersDisplay schema={op.parametersSchema} t={t} />
                </li>
              ))}
            </ul>
            <ContentCopyButton value={sqlOperationsSummary} />
          </div>
        </SectionRow>
      )}

      {isSql && integration.isActive && integration.sqlConnectionConfig && (
        <SectionRow
          label={t('integrations.upload.sqlConfig')}
          expanded={expanded.has('sqlConfig')}
          onToggle={() => toggle('sqlConfig')}
          isLast={lastSection === 'sqlConfig'}
        >
          <div className="border-border bg-muted border-x px-4 py-3">
            <StatGrid className="text-xs" items={sqlConfigItems} />
          </div>
        </SectionRow>
      )}

      {allowedHosts.length > 0 && (
        <SectionRow
          label={t('integrations.upload.allowedHosts')}
          expanded={expanded.has('allowedHosts')}
          onToggle={() => toggle('allowedHosts')}
          isLast={lastSection === 'allowedHosts'}
        >
          <div className="border-border bg-muted flex flex-wrap gap-1 border-x px-4 py-3">
            {allowedHosts.map((host) => (
              <Badge key={host} variant="outline">
                {host}
              </Badge>
            ))}
          </div>
        </SectionRow>
      )}

      {!isSql && (lineCount > 0 || connectorCodeLoading) && (
        <SectionRow
          label={t('integrations.upload.connectorCode')}
          badge={
            lineCount > 0 ? (
              <Badge variant="outline" className="text-xs">
                {lineCount} {t('integrations.upload.lines')}
              </Badge>
            ) : undefined
          }
          expanded={expanded.has('connectorCode')}
          onToggle={() => toggle('connectorCode')}
          isLast={lastSection === 'connectorCode'}
        >
          <div className="border-border bg-muted flex gap-3 border-x px-4 py-3">
            {lineCount > 0 ? (
              <>
                <pre className="relative max-h-96 flex-1 overflow-y-auto text-xs break-words whitespace-pre-wrap">
                  <code>{connectorCode}</code>
                </pre>
                <ContentCopyButton value={connectorCode} />
              </>
            ) : (
              <div className="flex-1 blur-[6px] select-none" aria-hidden>
                <pre className="text-muted-foreground text-xs leading-relaxed">
                  {
                    'const connector = {\n  operations: [],\n  secretBindings: [],\n  allowedHosts: [],\n};'
                  }
                </pre>
              </div>
            )}
          </div>
        </SectionRow>
      )}

      <IntegrationRelatedAutomations
        integrationName={integration.name ?? ''}
        organizationId={integration.organizationId ?? ''}
        isLast={lastSection === 'automations'}
      />

      {children && (
        <>
          {lastSection !== 'update' && (
            <div className="bg-border h-px w-full" />
          )}
          {children}
        </>
      )}
    </div>
  );
}
