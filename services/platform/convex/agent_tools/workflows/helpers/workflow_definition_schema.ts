/**
 * Shared workflow-definition input schemas for the LLM-facing agent tools.
 *
 * `create_workflow_tool.ts`, `save_workflow_definition_tool.ts`, and (W5b)
 * `workflows/specification_actions.ts::previewGraphFromSpecification` all ask
 * a model to produce the SAME `{ workflowConfig, stepsConfig[] }` shape —
 * extracted here once so the three call sites can't drift.
 */

import { z } from 'zod/v4';

export const workflowConfigSchema = z.object({
  name: z
    .string()
    .describe(
      'Human-readable workflow name (must be unique per organization).',
    ),
  description: z
    .string()
    .optional()
    .describe('Optional description explaining what the workflow does.'),
  version: z
    .string()
    .optional()
    .describe('Optional version label, e.g. "1.0.0", "2.0.0".'),
  workflowType: z
    .enum(['predefined'])
    .optional()
    .describe('Workflow type; currently only "predefined" is supported.'),
  config: z
    .object({
      timeout: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Workflow timeout in milliseconds (e.g., 120000 for 2 minutes).',
        ),
      retryPolicy: z
        .object({
          maxRetries: z
            .number()
            .int()
            .nonnegative()
            .describe('Maximum retry attempts.'),
          backoffMs: z
            .number()
            .int()
            .nonnegative()
            .describe('Backoff delay between retries in ms.'),
        })
        .optional()
        .describe('Default retry policy for action steps.'),
      variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Initial workflow-level variables accessible to all steps via {{config.variableName}}. organizationId is auto-injected.',
        ),
    })
    .optional()
    .describe(
      'Workflow-level configuration: timeout, retryPolicy, and initial variables.',
    ),
  specification: z
    .string()
    .max(20_000)
    .optional()
    .describe(
      'Optional natural-language text specification of the workflow (if the user or agent already drafted one). Kept in sync with the step graph by the editor.',
    ),
});

export const stepConfigSchema = z.object({
  stepSlug: z
    .string()
    .describe('Unique step slug in snake_case (e.g., "find_customers").'),
  name: z
    .string()
    .describe('Human-readable step name (e.g., "Find Inactive Customers").'),
  stepType: z
    .enum(['start', 'llm', 'action', 'condition', 'loop', 'output'])
    .describe('Step type.'),
  config: z
    .record(z.string(), z.unknown())
    .describe('Step configuration object; structure depends on step type.'),
  nextSteps: z
    .record(z.string(), z.string())
    .describe(
      'Next step connections (e.g., {success: "next_step_id", failure: "error_handler"}).',
    ),
});

export type WorkflowConfigInput = z.infer<typeof workflowConfigSchema>;
export type StepConfigInput = z.infer<typeof stepConfigSchema>;
