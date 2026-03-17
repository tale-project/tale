import type { WorkflowTemplate } from '../constants/workflow-templates';

import { getWorkflowTemplateUrl } from '../constants/workflow-templates';

export interface WorkflowTemplateData {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: string;
    config?: Record<string, unknown>;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType:
      | 'start'
      | 'trigger'
      | 'llm'
      | 'condition'
      | 'action'
      | 'loop'
      | 'output';
    config: Record<string, unknown>;
    nextSteps: Record<string, string>;
  }>;
}

export interface FetchResult {
  success: boolean;
  data?: WorkflowTemplateData;
  error?: string;
}

const cache = new Map<string, FetchResult>();

export function clearWorkflowTemplateCache() {
  cache.clear();
}

function isWorkflowTemplateData(value: unknown): value is WorkflowTemplateData {
  return (
    !!value &&
    typeof value === 'object' &&
    'workflowConfig' in value &&
    'stepsConfig' in value
  );
}

export async function fetchWorkflowTemplate(
  template: WorkflowTemplate,
): Promise<FetchResult> {
  const cached = cache.get(template.path);
  if (cached) return cached;

  const url = getWorkflowTemplateUrl(template.path);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { success: false, error: 'Network error while fetching template' };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Failed to fetch template (${response.status})`,
    };
  }

  let data: unknown;
  try {
    const text = await response.text();
    data = JSON.parse(text);
  } catch {
    return { success: false, error: 'Invalid template format' };
  }

  if (!isWorkflowTemplateData(data)) {
    return { success: false, error: 'Invalid template structure' };
  }

  const result: FetchResult = { success: true, data };
  cache.set(template.path, result);
  return result;
}
