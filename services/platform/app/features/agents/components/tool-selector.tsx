'use client';

import { Grid, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { FormSection } from '@/app/components/ui/forms/form-section';
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
    'text',
    'pdf',
    'docx',
    'excel',
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
  // Tool labels live in the shared `chat.tools.*` namespace (one vocabulary for
  // the chat timeline and this picker); category labels stay in `settings`.
  const { t: tTools } = useT('chat');
  const { tools, isLoading } = useAvailableTools();
  const { integrations, isLoading: integrationsLoading } =
    useAvailableIntegrations(organizationId);
  const { workflows, isLoading: workflowsLoading } =
    useAvailableWorkflows(organizationId);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedIntegrationBindingsSet = useMemo(
    () => new Set(integrationBindings),
    [integrationBindings],
  );
  const selectedWorkflowBindingsSet = useMemo(
    () => new Set(workflowBindings),
    [workflowBindings],
  );

  const handleCategoryChange = useCallback(
    (categoryTools: string[], newValues: string[]) => {
      const categorySet = new Set(categoryTools);
      const otherValues = value.filter((v) => !categorySet.has(v));
      onChange([...otherValues, ...newValues]);
    },
    [value, onChange],
  );

  const toggleIntegrationBinding = useCallback(
    (integrationName: string) => {
      if (selectedIntegrationBindingsSet.has(integrationName)) {
        onIntegrationBindingsChange(
          integrationBindings.filter((b) => b !== integrationName),
        );
      } else {
        onIntegrationBindingsChange([...integrationBindings, integrationName]);
      }
    },
    [
      integrationBindings,
      onIntegrationBindingsChange,
      selectedIntegrationBindingsSet,
    ],
  );

  const toggleWorkflowBinding = useCallback(
    (workflowId: string) => {
      if (selectedWorkflowBindingsSet.has(workflowId)) {
        onWorkflowBindingsChange(
          workflowBindings.filter((b) => b !== workflowId),
        );
      } else {
        onWorkflowBindingsChange([...workflowBindings, workflowId]);
      }
    },
    [workflowBindings, onWorkflowBindingsChange, selectedWorkflowBindingsSet],
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
        selectedBindingsSet={selectedIntegrationBindingsSet}
        onToggle={toggleIntegrationBinding}
        t={t}
      />
      {showWorkflows && (
        <WorkflowBindingsSection
          workflows={workflows}
          isLoading={workflowsLoading}
          selectedBindingsSet={selectedWorkflowBindingsSet}
          onToggle={toggleWorkflowBinding}
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
  const placeholders = ['__p_int_0', '__p_int_1'];
  const isEmpty = !isLoading && (!integrations || integrations.length === 0);

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
          <Grid cols={2} className="gap-x-4 gap-y-1.5">
            {(isLoading
              ? placeholders.map((name) => ({ name, title: 'Integration' }))
              : (integrations ?? [])
            ).map((integration) => (
              <Checkbox
                key={integration.name}
                label={integration.title}
                checked={
                  !isLoading && selectedBindingsSet.has(integration.name)
                }
                onCheckedChange={() => onToggle(integration.name)}
              />
            ))}
          </Grid>
        )}
      </FormSection>
    </Skeletonize>
  );
}

function WorkflowBindingsSection({
  workflows,
  isLoading,
  selectedBindingsSet,
  onToggle,
  t,
}: {
  workflows:
    | Array<{ id: string; name: string; description?: string }>
    | undefined;
  isLoading: boolean;
  selectedBindingsSet: Set<string>;
  onToggle: (id: string) => void;
  t: (key: string) => string;
}) {
  const placeholders = ['__p_wf_0', '__p_wf_1'];
  const isEmpty = !isLoading && (!workflows || workflows.length === 0);

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
          <Grid cols={2} className="gap-x-4 gap-y-1.5">
            {(isLoading
              ? placeholders.map((id) => ({ id, name: 'Workflow' }))
              : (workflows ?? [])
            ).map((workflow) => (
              <Checkbox
                key={workflow.id}
                label={workflow.name}
                checked={!isLoading && selectedBindingsSet.has(workflow.id)}
                onCheckedChange={() => onToggle(workflow.id)}
              />
            ))}
          </Grid>
        )}
      </FormSection>
    </Skeletonize>
  );
}
