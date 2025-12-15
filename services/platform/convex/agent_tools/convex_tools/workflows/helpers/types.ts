import type { Doc } from '../../../../_generated/dataModel';

export type WorkflowReadGetStructureResult = {
  operation: 'get_structure';
  workflow: Doc<'wfDefinitions'> | null;
  steps: Doc<'wfStepDefs'>[];
};

export type WorkflowExample = {
  workflowId: string;
  name: string;
  description: string;
  status: string;
  stepCount: number;
  steps: Doc<'wfStepDefs'>[];
};

export type WorkflowReadSearchExamplesResult = {
  operation: 'search_examples';
  totalFound: number;
  returned: number;
  examples: WorkflowExample[];
  suggestion: string;
  error?: string;
  message?: string;
};

export type WorkflowSummary = {
  workflowId: string;
  name: string;
  description?: string;
  status: string;
  version: string;
  versionNumber: number;
  stepCount?: number;
};

export type WorkflowReadListAllResult = {
  operation: 'list_all';
  totalWorkflows: number;
  workflows: WorkflowSummary[];
  message?: string;
  error?: string;
};

export type WorkflowReadGetActiveVersionStepsResult = {
  operation: 'get_active_version_steps';
  workflow: Doc<'wfDefinitions'> | null;
  steps: Doc<'wfStepDefs'>[];
  message?: string;
  error?: string;
};

export type WorkflowVersionWithSteps = {
  workflowId: string;
  name: string;
  description?: string;
  version: string;
  versionNumber: number;
  status: string;
  publishedAt?: number;
  publishedBy?: string;
  changeLog?: string;
  stepCount?: number;
  steps?: Doc<'wfStepDefs'>[];
};

export type WorkflowReadListVersionHistoryResult = {
  operation: 'list_version_history';
  totalVersions: number;
  versions: WorkflowVersionWithSteps[];
  message?: string;
  error?: string;
};
