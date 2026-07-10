'use client';

import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { rankTokens, scoreText } from '@tale/ui/search';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import {
  BookOpen,
  Bot,
  ChartColumn,
  Compass,
  Folder,
  Globe,
  Inbox,
  ListTodo,
  MessageCircle,
  Package,
  Plug,
  SearchX,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useAutomationDisplay } from '@/app/features/automations/hooks/use-automation-text';
import { toolDisplayName } from '@/app/features/chat/utils/format-tool-detail';
import type { ToolName } from '@/convex/agent_tools/tool_names';
import { useT } from '@/lib/i18n/client';

import {
  type AvailableAutomation,
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
// shared `toolDisplayName` map; the one-line descriptions live under
// `settings.agents.tools.descriptions.*`.
const TOOL_CATEGORIES: Record<string, ToolName[]> = {
  contacts: ['contact_read', 'contact_write'],
  products: ['product_read', 'product_write'],
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

// One Lucide glyph per category so a group reads at a glance (app design rule:
// Lucide only). Uncategorized runtime tools land in "system" → Wrench.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  contacts: Users,
  products: Package,
  websites: Globe,
  conversations: Inbox,
  discussions: MessageCircle,
  knowledge: BookOpen,
  tasksProjects: ListTodo,
  agents: Bot,
  workflows: Workflow,
  integrations: Plug,
  analytics: ChartColumn,
  web: Compass,
  files: Folder,
  system: Wrench,
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
  // the chat timeline and this picker); category labels and the one-line tool
  // descriptions stay in `settings`.
  const { t: tTools } = useT('chat');
  const { tools, isLoading } = useAvailableTools();
  const { integrations, isLoading: integrationsLoading } =
    useAvailableIntegrations(organizationId);
  const { workflows: automations, isLoading: automationsLoading } =
    useAvailableWorkflows(organizationId);

  const [query, setQuery] = useState('');

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

  // A tool without registered copy degrades to "no description" instead of
  // leaking the raw key (a future tool can land before its translations).
  const toolDescription = useCallback(
    (name: string): string | undefined => {
      const text = t(`agents.tools.descriptions.${name}`, {
        defaultValue: '',
      });
      return text === '' ? undefined : text;
    },
    [t],
  );

  const tokens = useMemo(() => rankTokens(query), [query]);

  // Search matches a tool's localized label, its description, its raw name
  // (what power users know), and its category label — the same AND-token model
  // as the global search (`scoreText` doubles as the filter).
  const filteredCategories = useMemo(() => {
    const result: Array<[string, string[]]> = [];
    for (const [category, toolNames] of categorized.entries()) {
      const categoryLabel = t(`agents.tools.categories.${category}`);
      const matched = toolNames.filter(
        (name) =>
          scoreText(
            `${toolDisplayName(tTools, name)} ${toolDescription(name) ?? ''} ${name} ${categoryLabel}`,
            tokens,
          ) > 0,
      );
      if (matched.length > 0) result.push([category, matched]);
    }
    return result;
  }, [categorized, tokens, t, tTools, toolDescription]);

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
        <AutomationBindingsSection
          automations={automations}
          isLoading={automationsLoading}
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
  // card structure with placeholder rows; `Checkbox` and `Badge` self-mask
  // under `<Skeletonize loading>`. Static category labels stay real text.
  const displayCategories: Array<[string, string[]]> = isLoading
    ? [
        ['contacts', ['__p_contacts_0', '__p_contacts_1']],
        ['knowledge', ['__p_knowledge_0', '__p_knowledge_1']],
        ['workflows', ['__p_workflows_0', '__p_workflows_1']],
      ]
    : filteredCategories;

  const noMatches =
    !isLoading && query !== '' && filteredCategories.length === 0;

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
          {showPlatformTools && (
            <Stack gap={4}>
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('agents.tools.searchPlaceholder')}
                disabled={isLoading}
              />
              {noMatches ? (
                <Card padding="md">
                  <EmptyState
                    icon={SearchX}
                    title={tCommon('search.noResults')}
                    description={tCommon('search.tryAdjusting')}
                  />
                </Card>
              ) : (
                <div className="grid items-start gap-4 md:grid-cols-2">
                  {displayCategories.map(([category, toolNames]) => (
                    <ToolCategoryCard
                      key={category}
                      category={category}
                      toolNames={toolNames}
                      selectedSet={selectedSet}
                      isLoading={isLoading}
                      onCategoryChange={handleCategoryChange}
                      toolDescription={toolDescription}
                      t={t}
                      tTools={tTools}
                    />
                  ))}
                </div>
              )}
            </Stack>
          )}

          {(!showPlatformTools || !isLoading) && bindingsSections}
        </Stack>
      </fieldset>
    </Skeletonize>
  );
}

function ToolCategoryCard({
  category,
  toolNames,
  selectedSet,
  isLoading,
  onCategoryChange,
  toolDescription,
  t,
  tTools,
}: {
  category: string;
  toolNames: string[];
  selectedSet: Set<string>;
  isLoading: boolean;
  onCategoryChange: (categoryTools: string[], newValues: string[]) => void;
  toolDescription: (name: string) => string | undefined;
  t: TFunction;
  tTools: TFunction;
}) {
  const label = t(`agents.tools.categories.${category}`);
  const Icon = CATEGORY_ICONS[category] ?? Wrench;

  const enabledValues = isLoading
    ? []
    : toolNames.filter((name) => selectedSet.has(name));
  const enabled = enabledValues.length;
  const total = toolNames.length;
  const allSelected = !isLoading && total > 0 && enabled === total;
  const someSelected = enabled > 0 && !allSelected;

  return (
    <Card padding="md">
      <Stack gap={3}>
        <Row gap={2} align="center" justify="between">
          <Row gap={2} align="center" className="min-w-0">
            <Icon
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            {/* Parent checkbox: the category label doubles as enable-all for
                the tools this card currently SHOWS — under an active search
                filter it only ever toggles the visible rows, never hidden
                ones. */}
            <Checkbox
              label={label}
              checked={
                allSelected ? true : someSelected ? 'indeterminate' : false
              }
              onCheckedChange={(checked) =>
                onCategoryChange(
                  toolNames,
                  checked === true ? [...toolNames] : [],
                )
              }
              disabled={isLoading}
            />
          </Row>
          <Badge
            aria-label={t('agents.tools.enabledCountLabel', {
              enabled,
              total,
            })}
          >
            {t('agents.tools.enabledCount', { enabled, total })}
          </Badge>
        </Row>
        <CheckboxGroup
          columns={1}
          options={toolNames.map((name) => ({
            value: name,
            label: isLoading ? 'Tool name' : toolDisplayName(tTools, name),
            description: isLoading ? undefined : toolDescription(name),
            disabled: isLoading,
          }))}
          value={enabledValues}
          onValueChange={(values) => onCategoryChange(toolNames, values)}
        />
      </Stack>
    </Card>
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

/**
 * The agent form's automation-bindings picker. Options are still keyed by
 * WORKFLOW slug (the persisted `workflowBindings` value — an automation-owned
 * workflow's slug IS its automation's slug), but the label/description shown
 * are the owning AUTOMATION's self-translated `name`/`description`
 * (`useAutomationDisplay`, never a raw literal) whenever one owns the
 * workflow; a standalone workflow (no owning automation) falls back to its
 * own name/spec-summary.
 */
function AutomationBindingsSection({
  automations,
  isLoading,
  value,
  onChange,
  searchPlaceholder,
  emptyText,
  t,
}: {
  automations: AvailableAutomation[] | undefined;
  isLoading: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder: string;
  emptyText: string;
  t: (key: string) => string;
}) {
  const resolveAutomation = useAutomationDisplay();
  const isEmpty = !isLoading && (!automations || automations.length === 0);
  const options = useMemo(
    () =>
      (automations ?? []).map((workflow) => {
        const display =
          workflow.automationName !== undefined
            ? resolveAutomation({
                name: workflow.automationName,
                description: workflow.automationDescription,
                i18n: workflow.automationI18n,
              })
            : { name: workflow.name, description: workflow.description };
        return {
          value: workflow.slug,
          label: display.name,
          description: display.description,
        };
      }),
    [automations, resolveAutomation],
  );

  return (
    <Skeletonize
      loading={isLoading}
      label={t('agents.form.sectionAutomationBindings')}
    >
      <FormSection
        label={t('agents.form.sectionAutomationBindings')}
        description={t('agents.form.sectionAutomationBindingsDescription')}
      >
        {isEmpty ? (
          <Text variant="caption" className="italic">
            {t('agents.form.noAutomationsAvailable')}
          </Text>
        ) : (
          <MultiSelect
            value={value}
            onValueChange={onChange}
            options={options}
            placeholder={t('agents.form.bindAutomationsPlaceholder')}
            searchPlaceholder={searchPlaceholder}
            emptyText={emptyText}
            aria-label={t('agents.form.sectionAutomationBindings')}
          />
        )}
      </FormSection>
    </Skeletonize>
  );
}
