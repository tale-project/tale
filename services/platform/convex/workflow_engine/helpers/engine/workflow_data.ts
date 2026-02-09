/**
 * Shared workflow data structure used by database-backed workflows.
 */

export interface WorkflowData<TDefinition = unknown, TStep = unknown> {
  definition: TDefinition;
  steps: Array<
    TStep & {
      stepSlug: string;
      order: number;
      config: unknown;
    }
  >;
  stepsConfigMap: Record<string, unknown>;
  workflowConfigJson: string;
}
