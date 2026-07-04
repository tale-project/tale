'use client';

import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { toolDisplayName } from '@/app/features/chat/utils/format-tool-detail';
import type { ToolName } from '@/convex/agent_tools/tool_names';
import { useT } from '@/lib/i18n/client';

import {
  useAvailableIntegrations,
  useAvailableTools,
  useAvailableWorkflows,
} from '../hooks/queries';

interface ToolSelectorProps {
  value: string[];
  onChange: (tools: string[]) => void;
  integrationBindings: string[];
  onIntegrationBindingsChange: (bindings: string[]) => void;
  workflowBindings: string[];
  onWorkflowBindingsChange: (bindings: string[]) => void;
  organizationId: string;
  hiddenTools?: Set<string>;
  disabled?: boolean;
  /**
   * Platform tools (`toolNames`) + Workflows run only in the chat tool loop, so
   * external agents must not list them (the save schema rejects a non-empty
   * list). Default `true`; the agent editor passes `false` for both on an
   * external agent, leaving only the integration bindings — which an external
   * agent DOES use as its sandbox MCP grant set.
   */
  showPlatformTools?: boolean;
  showWorkflows?: boolean;
}

// Tools grouped by the business domain they act on, ordered most- to
// least-common, with cross-cutting plumbing (files, code, prompts for
// input/memory) last under "system". Keys map to
// `settings.agents.tools.categories.*` labels; every tool name in
// `TOOL_NAMES` lives in exactly one bucket so nothing falls through to the
// uncategorized "system" tail at runtime. Tool labels themselves come from the
// shared `toolDisplayName` map.
const TOOL_CATEGORIES: Record<string, ToolName[]> = {
  customers: ['customer_read', 'customer_write'],
  products: ['product_read', 'product_write'],
  vendors: ['vendor_read', 'vendor_write'],
  websites: ['website_read', 'website_write'],
  conversations: ['conversation_read', 'conversation_write'],
  discussions: ['discussion_read', 'discussion_write'],
  knowledge: [
    'rag_search',
    'knowledge_write',
    'document_find',
    'document_retrieve',
    'document_write',
  ],
  tasksProjects: [
    'task_read',
    'task_write',
    'project_read',
    'project_write',
    'update_todos',
  ],
  agents: ['agent_read', 'agent_write'],
  workflows: [
    'workflow_read',
    'workflow_syntax',
    'update_workflow_step',
    'save_workflow_definition',
    'create_workflow',
    'run_workflow',
  ],
  integrations: [
    'integration',
    'integration_batch',
    'integration_introspect',
    'database_schema',
  ],
  analytics: ['metrics_read'],
  web: ['web'],
  files: [
    'file_read',
    'file_write',
    'file_edit',
    'file_list',
    'file_delete',
    'image',
    'generate_image',
  ],
  system: [
    'run_code',
    'request_human_input',
    'request_user_location',
    'propose_memory',
    'secret_read',
  ],
};

function categorizeTools(toolNames: string[]) {
  const categorized = new Map<string, string[]>();
  const assigned = new Set();

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    const matched = tools.filter((t) => toolNames.includes(t));
    if (matched.length > 0) {
      categorized.set(category, matched);
      for (const t of matched) assigned.add(t);
    }
  }

  const uncategorized = toolNames.filter((t) => !assigned.has(t));
  if (uncategorized.length > 0) {
    const existing = categorized.get('system') ?? [];
    categorized.set('system', [...existing, ...uncategorized]);
  }

  return categorized;
}

export function ToolSelector({
  value,
  onChange,
  integrationBindings,
  onIntegrationBindingsChange,
  workflowBindings,
  onWorkflowBindingsChange,
  organizationId,
  hiddenTools,
  disabled,
  showPlatformTools = true,
  showWorkflows = true,
}: ToolSelectorProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  // Tool labels live in the shared `chat.tools.*` namespace (one vocabulary for
  // the chat timeline and this picker); category labels stay in `settings`.
  const { t: tTools } = useT('chat');
  const { tools, isLoading } = useAvailableTools();
  const { integrations, isLoading: integrationsLoading } =
    useAvailableIntegrations(organizationId);
  const { workflows, isLoading: workflowsLoading } =
    useAvailableWorkflows(organizationId);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const handleCategoryChange = useCallback(
    (categoryTools: string[], newValues: string[]) => {
      const categorySet = new Set(categoryTools);
      const otherValues = value.filter((v) => !categorySet.has(v));
      onChange([...otherValues, ...newValues]);
    },
    [value, onChange],
  );

  const availableToolNames = useMemo(
    () =>
      (
        tools?.map((tool: { name: string; available: boolean }) => tool.name) ??
        []
      ).filter((name: string) => !hiddenTools?.has(name)),
    [tools, hiddenTools],
  );

  const categorized = useMemo(
    () => categorizeTools(availableToolNames),
    [availableToolNames],
  );

  const bindingsSections = (
    <Stack gap={4}>
      <IntegrationBindingsSection
        integrations={integrations}
        isLoading={integrationsLoading}
        value={integrationBindings}
        onChange={onIntegrationBindingsChange}
        searchPlaceholder={tCommon('search.placeholder')}
        emptyText={tCommon('search.noResults')}
        t={t}
      />
      {showWorkflows && (
        <WorkflowBindingsSection
          workflows={workflows}
          isLoading={workflowsLoading}
          value={workflowBindings}
          onChange={onWorkflowBindingsChange}
          searchPlaceholder={tCommon('search.placeholder')}
          emptyText={tCommon('search.noResults')}
          t={t}
        />
      )}
    </Stack>
  );

  // While the catalog loads there are no real categories, so render the real
  // CheckboxGroup structure with placeholder rows; `Checkbox` self-masks under
  // `<Skeletonize loading>`. Static category labels stay real text.
  const displayCategories: Array<[string, string[]]> = isLoading
    ? [
        ['customers', ['__p_customers_0', '__p_customers_1']],
        ['knowledge', ['__p_knowledge_0', '__p_knowledge_1']],
        ['workflows', ['__p_workflows_0', '__p_workflows_1']],
      ]
    : Array.from(categorized.entries());

  // External agents hide the platform-tools catalog, so the integration
  // bindings below shouldn't wait on the tools query they never read.
  const skeletonLoading = showPlatformTools && isLoading;

  return (
    <Skeletonize
      loading={skeletonLoading}
      label={t('agents.form.sectionTools')}
    >
      <fieldset disabled={disabled}>
        <Stack gap={4}>
          {showPlatformTools &&
            displayCategories.map(([category, toolNames]) => (
              <CheckboxGroup
                key={category}
                label={t(`agents.tools.categories.${category}`)}
                options={toolNames.map((name) => ({
                  value: name,
                  label: isLoading
                    ? 'Tool name'
                    : toolDisplayName(tTools, name),
                  disabled: isLoading,
                }))}
                value={
                  isLoading
                    ? []
                    : toolNames.filter((name) => selectedSet.has(name))
                }
                onValueChange={(values) =>
                  handleCategoryChange(toolNames, values)
                }
              />
            ))}

          {(!showPlatformTools || !isLoading) && bindingsSections}
        </Stack>
      </fieldset>
    </Skeletonize>
  );
}

function IntegrationBindingsSection({
  integrations,
  isLoading,
  value,
  onChange,
  searchPlaceholder,
  emptyText,
  t,
}: {
  integrations:
    | Array<{ name: string; title: string; type: string }>
    | undefined;
  isLoading: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder: string;
  emptyText: string;
  t: (key: string) => string;
}) {
  const isEmpty = !isLoading && (!integrations || integrations.length === 0);
  const options = useMemo(
    () =>
      (integrations ?? []).map((integration) => ({
        value: integration.name,
        label: integration.title,
      })),
    [integrations],
  );

  return (
    <Skeletonize
      loading={isLoading}
      label={t('agents.form.sectionIntegrationBindings')}
    >
      <FormSection
        label={t('agents.form.sectionIntegrationBindings')}
        description={t('agents.form.sectionIntegrationBindingsDescription')}
      >
        {isEmpty ? (
          <Text variant="caption" className="italic">
            {t('agents.form.noIntegrationsAvailable')}
          </Text>
        ) : (
          <MultiSelect
            value={value}
            onValueChange={onChange}
            options={options}
            placeholder={t('agents.form.bindIntegrationsPlaceholder')}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            aria-label={t('agents.form.sectionIntegrationBindings')}
          />
        )}
      </FormSection>
    </Skeletonize>
  );
}

function WorkflowBindingsSection({
  workflows,
  isLoading,
  value,
  onChange,
  searchPlaceholder,
  emptyText,
  t,
}: {
  workflows:
    | Array<{ id: string; name: string; description?: string }>
    | undefined;
  isLoading: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder: string;
  emptyText: string;
  t: (key: string) => string;
}) {
  const isEmpty = !isLoading && (!workflows || workflows.length === 0);
  const options = useMemo(
    () =>
      (workflows ?? []).map((workflow) => ({
        value: workflow.id,
        label: workflow.name,
        description: workflow.description,
      })),
    [workflows],
  );

  return (
    <Skeletonize
      loading={isLoading}
      label={t('agents.form.sectionWorkflowBindings')}
    >
      <FormSection
        label={t('agents.form.sectionWorkflowBindings')}
        description={t('agents.form.sectionWorkflowBindingsDescription')}
      >
        {isEmpty ? (
          <Text variant="caption" className="italic">
            {t('agents.form.noWorkflowsAvailable')}
          </Text>
        ) : (
          <MultiSelect
            value={value}
            onValueChange={onChange}
            options={options}
            placeholder={t('agents.form.bindWorkflowsPlaceholder')}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            aria-label={t('agents.form.sectionWorkflowBindings')}
          />
        )}
      </FormSection>
    </Skeletonize>
  );
}
