/**
 * Helper for reading predefined workflows from TypeScript files
 */

import { workflows } from '../../../predefined_workflows';

type WorkflowDefinition = {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType: string;
    config?: Record<string, unknown>;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: string;
    order: number;
    config: unknown;
    nextSteps: Record<string, string>;
  }>;
};

export type WorkflowReadListPredefinedResult = {
  operation: 'list_predefined';
  count: number;
  workflows: Array<{
    key: string;
    name: string;
    description: string;
    version: string;
    stepCount: number;
  }>;
};

export type WorkflowReadGetPredefinedResult = {
  operation: 'get_predefined';
  found: boolean;
  key?: string;
  workflow?: WorkflowDefinition;
  message?: string;
};

/**
 * List all predefined workflows with basic info
 */
export function listPredefinedWorkflows(): WorkflowReadListPredefinedResult {
  const workflowEntries = Object.entries(workflows) as [string, WorkflowDefinition][];
  
  const workflowList = workflowEntries.map(([key, wf]) => ({
    key,
    name: wf.workflowConfig.name,
    description: wf.workflowConfig.description || 'No description',
    version: wf.workflowConfig.version || '1.0.0',
    stepCount: wf.stepsConfig.length,
  }));

  return {
    operation: 'list_predefined',
    count: workflowList.length,
    workflows: workflowList,
  };
}

/**
 * Get a specific predefined workflow by key
 */
export function getPredefinedWorkflow(args: {
  workflowKey: string;
}): WorkflowReadGetPredefinedResult {
  const { workflowKey } = args;
  
  const workflowEntries = Object.entries(workflows) as [string, WorkflowDefinition][];
  
  // Try exact match first
  let found = workflowEntries.find(([key]) => key === workflowKey);
  
  // Try case-insensitive match
  if (!found) {
    found = workflowEntries.find(
      ([key]) => key.toLowerCase() === workflowKey.toLowerCase()
    );
  }
  
  // Try partial match (contains) - but only if there's exactly one match
  if (!found) {
    const partialMatches = workflowEntries.filter(([key]) =>
      key.toLowerCase().includes(workflowKey.toLowerCase()),
    );
    if (partialMatches.length === 1) {
      found = partialMatches[0];
    } else if (partialMatches.length > 1) {
      const matchedKeys = partialMatches.map(([key]) => key).join(', ');
      return {
        operation: 'get_predefined',
        found: false,
        message: `Multiple workflows match "${workflowKey}": ${matchedKeys}. Please be more specific.`,
      };
    }
  }

  if (!found) {
    const availableKeys = workflowEntries.map(([key]) => key).join(', ');
    return {
      operation: 'get_predefined',
      found: false,
      message: `Predefined workflow "${workflowKey}" not found. Available: ${availableKeys}`,
    };
  }

  const [key, workflow] = found;
  return {
    operation: 'get_predefined',
    found: true,
    key,
    workflow,
  };
}

