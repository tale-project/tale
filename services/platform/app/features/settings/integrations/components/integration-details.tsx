'use client';

import { Check, Code, Copy, Database, Globe, Zap } from 'lucide-react';
import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { Badge } from '@/app/components/ui/feedback/badge';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { HStack } from '@/app/components/ui/layout/layout';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Text } from '@/app/components/ui/typography/text';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

interface IntegrationDetailsProps {
  integration: Doc<'integrations'> & { iconUrl?: string | null };
  children?: React.ReactNode;
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
    <CollapsibleDetails
      variant="compact"
      className="mt-1"
      summary={
        <>
          {t('integrations.manageDialog.parameters')}
          <Badge variant="outline" className="text-[10px] leading-tight">
            {params.length}
          </Badge>
        </>
      }
    >
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
    </CollapsibleDetails>
  );
}

export function IntegrationDetails({
  integration,
  children,
}: IntegrationDetailsProps) {
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

  const hasAnyDetails =
    restOperations.length > 0 ||
    sqlOperations.length > 0 ||
    allowedHosts.length > 0 ||
    (lineCount > 0 && !isSql) ||
    !!children;

  if (!hasAnyDetails) return null;

  return (
    <BorderedSection gap={3}>
      {restOperations.length > 0 && (
        <CollapsibleDetails
          summary={
            <>
              <Zap className="size-4 shrink-0" />
              <span>{t('integrations.upload.operations')}</span>
              <Badge variant="outline" className="text-xs">
                {restOperations.length}
              </Badge>
              <CopyButton value={operationsSummary} />
            </>
          }
        >
          <ul
            className="bg-muted mt-2 ml-6 max-h-48 space-y-1 overflow-y-auto rounded-md p-3 text-sm"
            role="list"
          >
            {restOperations.map((op) => (
              <li key={op.name} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
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
        </CollapsibleDetails>
      )}

      {sqlOperations.length > 0 && (
        <CollapsibleDetails
          summary={
            <>
              <Database className="size-4 shrink-0" />
              <span>{t('integrations.manageDialog.sqlOperations')}</span>
              <Badge variant="outline" className="text-xs">
                {sqlOperations.length}
              </Badge>
              <CopyButton value={sqlOperationsSummary} />
            </>
          }
        >
          <ul
            className="bg-muted mt-2 ml-6 max-h-60 space-y-2 overflow-y-auto rounded-md p-3 text-sm"
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
                <CollapsibleDetails
                  variant="compact"
                  className="mt-1"
                  summary={
                    <>
                      {t('integrations.manageDialog.query')}
                      <SqlQueryCopyButton query={op.query} />
                    </>
                  }
                >
                  <pre className="bg-background mt-1 max-h-32 overflow-y-auto rounded border p-2 text-xs break-words whitespace-pre-wrap">
                    {op.query}
                  </pre>
                </CollapsibleDetails>
                <ParametersDisplay schema={op.parametersSchema} t={t} />
              </li>
            ))}
          </ul>
        </CollapsibleDetails>
      )}

      {isSql && integration.isActive && integration.sqlConnectionConfig && (
        <CollapsibleDetails
          summary={
            <>
              <Database className="size-4 shrink-0" />
              <span>{t('integrations.upload.sqlConfig')}</span>
            </>
          }
        >
          <StatGrid
            className="bg-muted mt-2 ml-6 rounded-md p-3 text-xs"
            items={sqlConfigItems}
          />
        </CollapsibleDetails>
      )}

      {allowedHosts.length > 0 && (
        <CollapsibleDetails
          summary={
            <>
              <Globe className="size-4 shrink-0" />
              <span>{t('integrations.upload.allowedHosts')}</span>
            </>
          }
        >
          <HStack gap={1} className="mt-2 ml-6 flex-wrap">
            {allowedHosts.map((host) => (
              <Badge key={host} variant="outline">
                {host}
              </Badge>
            ))}
          </HStack>
        </CollapsibleDetails>
      )}

      {lineCount > 0 && !isSql && (
        <CollapsibleDetails
          className="min-w-0"
          summary={
            <>
              <Code className="size-4 shrink-0" />
              <span>{t('integrations.upload.connectorCode')}</span>
              <Badge variant="outline" className="text-xs">
                {lineCount} {t('integrations.upload.lines')}
              </Badge>
              <CopyButton value={connectorCode} />
            </>
          }
        >
          <pre className="bg-muted mt-2 ml-6 max-h-96 overflow-y-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
            <code>{connectorCode}</code>
          </pre>
        </CollapsibleDetails>
      )}

      {children}
    </BorderedSection>
  );
}
