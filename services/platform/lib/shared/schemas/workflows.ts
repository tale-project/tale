import { z } from 'zod/v4';

/**
 * Schema for the workflow JSON file format.
 *
 * This is the canonical schema for workflow files stored on disk.
 * It mirrors the structure used by the workflow engine but is independently
 * defined (Zod for file I/O, Convex validators for the DB layer).
 *
 * Reference: convex/workflow_engine/types/nodes.ts for step config shapes.
 */

const stepSlugRegex = /^[a-z0-9][a-z0-9_-]*$/;

const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0),
  backoffMs: z.number().int().min(0),
});

const secretRefSchema = z.object({
  envVar: z.string().min(1),
});

const workflowConfigSchema = z.object({
  timeout: z.number().int().positive().optional(),
  retryPolicy: retryPolicySchema.optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), secretRefSchema).optional(),
});

const stepTypeSchema = z.enum([
  'start',
  'trigger',
  'llm',
  'condition',
  'action',
  'loop',
  'output',
]);

const workflowStepSchema = z.object({
  stepSlug: z.string().min(1).regex(stepSlugRegex),
  name: z.string().min(1),
  stepType: stepTypeSchema,
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  nextSteps: z.record(z.string(), z.string()).default({}),
});

export const workflowJsonSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  version: z.string().optional(),
  installed: z.boolean().default(false),
  enabled: z.boolean().default(false),
  config: workflowConfigSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(workflowStepSchema),
});

export type WorkflowJsonConfig = z.infer<typeof workflowJsonSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type StepType = z.infer<typeof stepTypeSchema>;
