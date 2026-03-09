'use client';

import { useCallback, useMemo } from 'react';

import type { ToolName } from '@/convex/agent_tools/tool_names';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { useAvailableIntegrations, useAvailableTools } from '../hooks/queries';

interface ToolSelectorProps {
  value: string[];
  onChange: (tools: string[]) => void;
  integrationBindings: string[];
  onIntegrationBindingsChange: (bindings: string[]) => void;
  organizationId: string;
  hiddenTools?: Set<string>;
  disabled?: boolean;
}

const TOOL_CATEGORIES: Record<string, ToolName[]> = {
  CRM: ['customer_read', 'product_read'],
  Web: ['web'],
  Documents: ['pdf', 'image', 'pptx', 'docx', 'txt', 'excel'],
  Knowledge: ['rag_search', 'document_retrieve', 'document_list'],
  Workflows: [
    'workflow_read',
    'workflow_examples',
    'update_workflow_step',
    'save_workflow_definition',
    'create_workflow',
    'run_workflow',
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
  hiddenTools,
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

  const handleCategoryChange = useCallback(
    (categoryTools: string[], newValues: string[]) => {
      const categorySet = new Set(categoryTools);
      const otherValues = value.filter((v) => !categorySet.has(v));
      onChange([...otherValues, ...newValues]);
    },
    [value, onChange],
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
    () =>
      (tools?.map((tool) => tool.name) ?? []).filter(
        (name) => !hiddenTools?.has(name),
      ),
    [tools, hiddenTools],
  );

  const categorized = useMemo(
    () => categorizeTools(availableToolNames),
    [availableToolNames],
  );

  if (isLoading) {
    return (
      <Grid cols={2} gap={2}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </Grid>
    );
  }

  return (
    <fieldset disabled={disabled}>
      <Stack gap={4}>
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
            <CheckboxGroup
              label={category}
              options={toolNames.map((name) => ({ value: name, label: name }))}
              value={toolNames.filter((name) => selectedSet.has(name))}
              onValueChange={(values) =>
                handleCategoryChange(toolNames, values)
              }
            />
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
      </Stack>
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
        <Text variant="caption" className="italic">
          {t('customAgents.form.noIntegrationsAvailable')}
        </Text>
      ) : (
        <Grid cols={2} className="gap-x-4 gap-y-1.5">
          {integrations.map((integration) => (
            <HStack key={integration.name} gap={2}>
              <Checkbox
                label={integration.title}
                checked={selectedBindingsSet.has(integration.name)}
                onCheckedChange={() => onToggle(integration.name)}
              />
              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                {integration.type === 'sql' ? 'SQL' : 'API'}
              </Badge>
            </HStack>
          ))}
        </Grid>
      )}
    </FormSection>
  );
}
