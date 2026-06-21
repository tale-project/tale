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
  // Workflow-level fallback chain inherited by every LLM step that defines
  // neither `model` nor `models`. Step-level overrides win.
  models: z.array(z.string()).optional(),
});

const stepTypeSchema = z.enum([
  'start',
  'trigger',
  'llm',
  'condition',
  'action',
  'loop',
  'output',
  'sandbox',
]);

/**
 * Optional, declarative UI annotation on a step. Holds KEYS only (no literal
 * text — i18n labels resolve from platform/pack catalogs). `render`/`params`
 * are kept as lenient strings here so a workflow file always parses and
 * round-trips as the closed render-kind vocabulary evolves; known-ness is
 * enforced by `validateWorkflowDefinition` (publish-time) and the renderer
 * (graceful degradation at runtime). See lib/shared/platform/render_kinds.
 */
const workflowStepUiSchema = z.object({
  stage: z.string().optional(),
  render: z.string().min(1),
  labelKey: z.string().optional(),
  params: z
    .object({
      display: z.string().optional(),
      layout: z.string().optional(),
      entryKind: z.string().optional(),
      mode: z.string().optional(),
      cardinality: z.string().optional(),
      fields: z
        .array(
          z.object({
            key: z.string().min(1),
            labelKey: z.string().min(1),
            type: z.string().min(1),
          }),
        )
        .optional(),
      // Maps a `gate` step's scalar verdict (e.g. "yes"/"no") to a pack label
      // key, so the renderer can surface a clear verdict badge.
      verdictLabels: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

const workflowStepSchema = z.object({
  stepSlug: z.string().min(1).regex(stepSlugRegex),
  name: z.string().min(1),
  stepType: stepTypeSchema,
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  nextSteps: z.record(z.string(), z.string()).default({}),
  // Metadata-driven operator UI + role-bound steps (engine ignores both; the UI
  // renderer reads `ui` from the definition file, joined to live execution state).
  ui: workflowStepUiSchema.optional(),
  role: z.string().optional(),
});

const integrationDependencySchema = z.object({
  name: z.string().min(1),
  operations: z.array(z.string().min(1)).optional(),
  minVersion: z.number().int().positive().optional(),
});

const requiresSchema = z.object({
  integrations: z.array(integrationDependencySchema).default([]),
});

/**
 * Declarative triggers a workflow file ships with. The file format has no
 * runtime trigger semantics by itself — a workflow only fires when matching
 * `wfEventSubscriptions`/`wfSchedules` rows exist. This block lets shipped
 * workflows (the task-ops pack) DECLARE their intended triggers so the
 * provisioner (`workflows/provision_defaults.ts`) can create the rows once
 * per org, create-if-absent — org edits and deactivations always win.
 */
const workflowTriggersSchema = z.object({
  events: z
    .array(
      z.object({
        eventType: z.string().min(1),
        eventFilter: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
  schedules: z
    .array(
      z.object({
        cron: z.string().min(1),
        timezone: z.string().optional(),
        variables: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

/**
 * Per-locale overrides for the workflow's user-facing `name`/`description`,
 * mirroring the agent i18n-first model. Absent locales fall back to the
 * top-level `name`/`description` (English). Step `name`s stay engine-internal
 * and untranslated.
 */
const workflowI18nSchema = z.record(
  z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
);

export const workflowJsonSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Per-locale name/description overrides; see {@link workflowI18nSchema}. */
  i18n: workflowI18nSchema.optional(),
  version: z.string().optional(),
  config: workflowConfigSchema.optional(),
  // Documented metadata keys: `autoInstall?: boolean` (provision this
  // workflow + its declared triggers to every org), `labels?: string[]`
  // (catalog tags, e.g. ['Tasks','Automation']). Free-form record otherwise.
  metadata: z.record(z.string(), z.unknown()).optional(),
  triggers: workflowTriggersSchema.optional(),
  requires: requiresSchema.optional(),
  steps: z.array(workflowStepSchema).default([]),
});

export type WorkflowJsonConfig = z.infer<typeof workflowJsonSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowIntegrationDependency = z.infer<
  typeof integrationDependencySchema
>;
export type StepType = z.infer<typeof stepTypeSchema>;
