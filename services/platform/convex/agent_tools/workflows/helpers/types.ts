import type { WorkflowJsonConfig } from '../../../../lib/shared/schemas/workflows';

export type WorkflowReadGetStructureResult = {
  operation: 'get_structure';
  slug: string;
  config: WorkflowJsonConfig | null;
  hash?: string;
  message?: string;
  error?: string;
};

export type WorkflowSummary = {
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  version?: string;
  stepCount?: number;
};

export type WorkflowReadListAllResult = {
  operation: 'list_all';
  totalWorkflows: number;
  workflows: WorkflowSummary[];
  message?: string;
  error?: string;
};
