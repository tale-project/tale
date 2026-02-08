'use client';

import { useCallback, useMemo } from 'react';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useT } from '@/lib/i18n/client';
import { useAvailableTools } from '../hooks/use-available-tools';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';

interface ToolSelectorProps {
  value: string[];
  onChange: (tools: string[]) => void;
}

const TOOL_CATEGORIES: Record<string, string[]> = {
  'CRM': ['customer_read', 'product_read'],
  'Web': ['web', 'web_assistant', 'context_search'],
  'Documents': ['pdf', 'image', 'pptx', 'docx', 'txt', 'document_assistant'],
  'Knowledge': ['rag_search'],
  'Workflows': ['workflow_read', 'workflow_examples', 'update_workflow_step', 'save_workflow_definition', 'create_workflow', 'workflow_assistant'],
  'Integrations': ['integration', 'integration_batch', 'integration_introspect', 'integration_assistant'],
  'Data': ['generate_excel', 'database_schema', 'resource_check'],
  'Other': ['verify_approval', 'request_human_input', 'crm_assistant'],
};

function categorizeTools(toolNames: string[]) {
  const categorized = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    const matched = tools.filter((t) => toolNames.includes(t));
    if (matched.length > 0) {
      categorized.set(category, matched);
      matched.forEach((t) => assigned.add(t));
    }
  }

  const uncategorized = toolNames.filter((t) => !assigned.has(t));
  if (uncategorized.length > 0) {
    const existing = categorized.get('Other') ?? [];
    categorized.set('Other', [...existing, ...uncategorized]);
  }

  return categorized;
}

export function ToolSelector({ value, onChange }: ToolSelectorProps) {
  const { t } = useT('settings');
  const { tools, isLoading } = useAvailableTools();

  const selectedSet = useMemo(() => new Set(value), [value]);

  const toggleTool = useCallback(
    (toolName: string) => {
      if (selectedSet.has(toolName)) {
        onChange(value.filter((t) => t !== toolName));
      } else {
        onChange([...value, toolName]);
      }
    },
    [value, onChange, selectedSet],
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
    <fieldset>
      <legend className="text-sm font-medium text-foreground mb-2">
        {t('customAgents.form.tools')}
      </legend>
      <p className="text-xs text-muted-foreground mb-3">
        {t('customAgents.form.toolsDescription')}
      </p>
      <div className="space-y-4">
        {Array.from(categorized.entries()).map(([category, toolNames]) => (
          <div key={category}>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{category}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {toolNames.map((toolName) => (
                <Checkbox
                  key={toolName}
                  label={toolName}
                  checked={selectedSet.has(toolName)}
                  onCheckedChange={() => toggleTool(toolName)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
