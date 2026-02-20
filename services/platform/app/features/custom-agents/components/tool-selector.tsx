'use client';

import { useCallback, useMemo } from 'react';

import type { ToolName } from '@/convex/agent_tools/tool_names';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useT } from '@/lib/i18n/client';

import { useAvailableIntegrations, useAvailableTools } from '../hooks/queries';

interface ToolSelectorProps {
  value: string[];
  onChange: (tools: string[]) => void;
  integrationBindings: string[];
  onIntegrationBindingsChange: (bindings: string[]) => void;
  organizationId: string;
  lockedTools?: Set<string>;
  disabled?: boolean;
}

const TOOL_CATEGORIES: Record<string, ToolName[]> = {
  CRM: ['customer_read', 'product_read'],
  Web: ['web'],
  Documents: ['pdf', 'image', 'pptx', 'docx', 'txt', 'excel'],
  Knowledge: ['rag_search'],
  Workflows: [
    'workflow_read',
    'workflow_examples',
    'update_workflow_step',
    'save_workflow_definition',
    'create_workflow',
  ],
  Integrations: ['integration', 'integration_batch', 'integration_introspect'],
  Data: ['database_schema'],
  Other: ['verify_approval', 'request_human_input'],
};

function categorizeTools(toolNames: string[]) {
  const categorized = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    const matched = tools.filter((t) => toolNames.includes(t));
    if (matched.length > 0) {
      categorized.set(category, matched);
      for (const t of matched) assigned.add(t);
    }
  }

  const uncategorized = toolNames.filter((t) => !assigned.has(t));
  if (uncategorized.length > 0) {
    const existing = categorized.get('Other') ?? [];
    categorized.set('Other', [...existing, ...uncategorized]);
  }

  return categorized;
}

export function ToolSelector({
  value,
  onChange,
  integrationBindings,
  onIntegrationBindingsChange,
  organizationId,
  lockedTools,
  disabled,
}: ToolSelectorProps) {
  const { t } = useT('settings');
  const { tools, isLoading } = useAvailableTools();
  const { integrations, isLoading: integrationsLoading } =
    useAvailableIntegrations(organizationId);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedBindingsSet = useMemo(
    () => new Set(integrationBindings),
    [integrationBindings],
  );

  const toggleTool = useCallback(
    (toolName: string) => {
      if (lockedTools?.has(toolName)) return;
      if (selectedSet.has(toolName)) {
        onChange(value.filter((t) => t !== toolName));
      } else {
        onChange([...value, toolName]);
      }
    },
    [value, onChange, selectedSet, lockedTools],
  );

  const toggleBinding = useCallback(
    (integrationName: string) => {
      if (selectedBindingsSet.has(integrationName)) {
        onIntegrationBindingsChange(
          integrationBindings.filter((b) => b !== integrationName),
        );
      } else {
        onIntegrationBindingsChange([...integrationBindings, integrationName]);
      }
    },
    [integrationBindings, onIntegrationBindingsChange, selectedBindingsSet],
  );

  const availableToolNames = useMemo(
    () => tools?.map((t) => t.name) ?? [],
    [tools],
  );

  const categorized = useMemo(
    () => categorizeTools(availableToolNames),
    [availableToolNames],
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  return (
    <fieldset disabled={disabled}>
      <div className="space-y-4">
        {Array.from(categorized.entries()).map(([category, toolNames]) => (
          <div key={category}>
            {category === 'Other' && (
              <div className="mb-4">
                <IntegrationBindingsSection
                  integrations={integrations}
                  isLoading={integrationsLoading}
                  selectedBindingsSet={selectedBindingsSet}
                  onToggle={toggleBinding}
                  t={t}
                />
              </div>
            )}
            <p className="text-muted-foreground mb-1.5 text-xs font-medium">
              {category}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {toolNames.map((toolName) => {
                const isLocked = lockedTools?.has(toolName);
                return (
                  <div key={toolName} className="flex items-center gap-1">
                    <Checkbox
                      label={toolName}
                      checked={selectedSet.has(toolName)}
                      onCheckedChange={() => toggleTool(toolName)}
                      disabled={isLocked}
                    />
                    {isLocked && (
                      <span className="text-muted-foreground text-xs">
                        ({t('customAgents.form.managedByKnowledge')})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {!categorized.has('Other') && (
          <IntegrationBindingsSection
            integrations={integrations}
            isLoading={integrationsLoading}
            selectedBindingsSet={selectedBindingsSet}
            onToggle={toggleBinding}
            t={t}
          />
        )}
      </div>
    </fieldset>
  );
}

function IntegrationBindingsSection({
  integrations,
  isLoading,
  selectedBindingsSet,
  onToggle,
  t,
}: {
  integrations:
    | Array<{ name: string; title: string; type: string }>
    | undefined;
  isLoading: boolean;
  selectedBindingsSet: Set<string>;
  onToggle: (name: string) => void;
  t: (key: string) => string;
}) {
  if (isLoading) {
    return (
      <FormSection label={t('customAgents.form.sectionIntegrationBindings')}>
        <Skeleton className="h-6 w-full" />
      </FormSection>
    );
  }

  return (
    <FormSection
      label={t('customAgents.form.sectionIntegrationBindings')}
      description={t('customAgents.form.sectionIntegrationBindingsDescription')}
    >
      {!integrations || integrations.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          {t('customAgents.form.noIntegrationsAvailable')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {integrations.map((integration) => (
            <div key={integration.name} className="flex items-center gap-2">
              <Checkbox
                label={integration.title}
                checked={selectedBindingsSet.has(integration.name)}
                onCheckedChange={() => onToggle(integration.name)}
              />
              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                {integration.type === 'sql' ? 'SQL' : 'API'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </FormSection>
  );
}
