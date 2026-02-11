'use client';

import {
  Check,
  ChevronRight,
  Code,
  Copy,
  Database,
  Globe,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';

interface IntegrationDetailsProps {
  integration: Doc<'integrations'> & { iconUrl?: string | null };
}

function CopyButton({ value }: { value: string }) {
  const { t: tCommon } = useT('common');
  const { copied, onClick } = useCopyButton(value);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="hover:bg-muted/80 ml-auto shrink-0 cursor-pointer rounded p-1 transition-colors"
      aria-label={tCommon('actions.copy')}
    >
      {copied ? (
        <Check
          className="size-3.5 text-green-600 dark:text-green-400"
          aria-hidden="true"
        />
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
      onClick={onClick}
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

interface ParameterInfo {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs select-none">
        <ChevronRight className="size-3 shrink-0 transition-transform duration-200 group-open/params:rotate-90" />
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
              <span className="text-muted-foreground">{param.type}</span>
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

export function IntegrationDetails({ integration }: IntegrationDetailsProps) {
  const { t } = useT('settings');

  const restOperations = useMemo(
    () => integration.connector?.operations ?? [],
    [integration.connector],
  );

  const sqlOperations = useMemo(
    () => integration.sqlOperations ?? [],
    [integration.sqlOperations],
  );

  const allowedHosts = useMemo(
    () => integration.connector?.allowedHosts ?? [],
    [integration.connector],
  );

  const connectorCode = integration.connector?.code ?? '';
  const isSql = integration.type === 'sql';

  const lineCount = useMemo(
    () =>
      connectorCode.trim().length > 0
        ? connectorCode.trim().split('\n').length
        : 0,
    [connectorCode],
  );

  const operationsSummary = useCallback(() => {
    return restOperations
      .map((op) => (op.title ? `${op.name} — ${op.title}` : op.name))
      .join('\n');
  }, [restOperations]);

  const sqlOperationsSummary = useCallback(() => {
    return sqlOperations
      .map((op) => {
        const header = op.title ? `${op.name} — ${op.title}` : op.name;
        return `${header}\n${op.query}`;
      })
      .join('\n\n');
  }, [sqlOperations]);

  const hasAnyDetails =
    restOperations.length > 0 ||
    sqlOperations.length > 0 ||
    allowedHosts.length > 0 ||
    (lineCount > 0 && !isSql);

  if (!hasAnyDetails) return null;

  const summaryClasses =
    'flex cursor-pointer items-center gap-2 text-sm font-medium select-none';
  const chevronClasses =
    'size-3.5 text-muted-foreground shrink-0 transition-transform duration-200 group-open:rotate-90';

  return (
    <Stack gap={3} className="border-border rounded-lg border p-4">
      {/* REST operations */}
      {restOperations.length > 0 && (
        <details className="group">
          <summary className={summaryClasses}>
            <ChevronRight className={chevronClasses} />
            <Zap className="size-4 shrink-0" />
            <span>{t('integrations.upload.operations')}</span>
            <Badge variant="outline" className="text-xs">
              {restOperations.length}
            </Badge>
            <CopyButton value={operationsSummary()} />
          </summary>
          <ul
            className="bg-muted mt-2 ml-6 max-h-48 space-y-1 overflow-y-auto rounded-md p-3 text-sm"
            role="list"
          >
            {restOperations.map((op) => (
              <li key={op.name} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs">{op.name}</span>
                  {op.title && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      — {op.title}
                    </span>
                  )}
                </div>
                {op.description && (
                  <p className="text-muted-foreground text-xs">
                    {op.description}
                  </p>
                )}
                <ParametersDisplay schema={op.parametersSchema} t={t} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* SQL operations */}
      {sqlOperations.length > 0 && (
        <details className="group">
          <summary className={summaryClasses}>
            <ChevronRight className={chevronClasses} />
            <Database className="size-4 shrink-0" />
            <span>{t('integrations.manageDialog.sqlOperations')}</span>
            <Badge variant="outline" className="text-xs">
              {sqlOperations.length}
            </Badge>
            <CopyButton value={sqlOperationsSummary()} />
          </summary>
          <ul
            className="bg-muted mt-2 ml-6 max-h-60 space-y-2 overflow-y-auto rounded-md p-3 text-sm"
            role="list"
          >
            {sqlOperations.map((op) => (
              <li key={op.name}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs">{op.name}</span>
                  {op.title && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      — {op.title}
                    </span>
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
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {op.description}
                  </p>
                )}
                <details className="group/query mt-1">
                  <summary className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs select-none">
                    <ChevronRight className="size-3 shrink-0 transition-transform duration-200 group-open/query:rotate-90" />
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
        </details>
      )}

      {/* SQL config (read-only, only when active — inactive shows editable fields) */}
      {isSql && integration.isActive && integration.sqlConnectionConfig && (
        <details className="group">
          <summary className={summaryClasses}>
            <ChevronRight className={chevronClasses} />
            <Database className="size-4 shrink-0" />
            <span>{t('integrations.upload.sqlConfig')}</span>
          </summary>
          <dl className="bg-muted mt-2 ml-6 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md p-3 text-xs">
            <dt className="text-muted-foreground">
              {t('integrations.upload.engine')}
            </dt>
            <dd className="font-mono">
              {integration.sqlConnectionConfig.engine}
            </dd>
            {integration.sqlConnectionConfig.port != null && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.port')}
                </dt>
                <dd className="font-mono">
                  {integration.sqlConnectionConfig.port}
                </dd>
              </>
            )}
            {integration.sqlConnectionConfig.readOnly != null && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.readOnly')}
                </dt>
                <dd>
                  {integration.sqlConnectionConfig.readOnly ? 'Yes' : 'No'}
                </dd>
              </>
            )}
            {integration.sqlConnectionConfig.security?.maxResultRows !=
              null && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.maxResultRows')}
                </dt>
                <dd className="font-mono">
                  {integration.sqlConnectionConfig.security.maxResultRows}
                </dd>
              </>
            )}
            {integration.sqlConnectionConfig.security?.queryTimeoutMs !=
              null && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.queryTimeout')}
                </dt>
                <dd className="font-mono">
                  {integration.sqlConnectionConfig.security.queryTimeoutMs}
                </dd>
              </>
            )}
          </dl>
        </details>
      )}

      {/* Allowed hosts */}
      {allowedHosts.length > 0 && (
        <details className="group">
          <summary className={summaryClasses}>
            <ChevronRight className={chevronClasses} />
            <Globe className="size-4 shrink-0" />
            <span>{t('integrations.upload.allowedHosts')}</span>
          </summary>
          <HStack gap={1} className="mt-2 ml-6 flex-wrap">
            {allowedHosts.map((host) => (
              <Badge key={host} variant="outline">
                {host}
              </Badge>
            ))}
          </HStack>
        </details>
      )}

      {/* Connector code (REST API only) */}
      {lineCount > 0 && !isSql && (
        <details className="group min-w-0">
          <summary className={summaryClasses}>
            <ChevronRight className={chevronClasses} />
            <Code className="size-4 shrink-0" />
            <span>{t('integrations.upload.connectorCode')}</span>
            <Badge variant="outline" className="text-xs">
              {lineCount} {t('integrations.upload.lines')}
            </Badge>
            <CopyButton value={connectorCode} />
          </summary>
          <pre className="bg-muted mt-2 ml-6 max-h-96 overflow-y-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
            <code>{connectorCode}</code>
          </pre>
        </details>
      )}
    </Stack>
  );
}
