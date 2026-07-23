/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Faithful copy of the retired `lib/shared/schemas/workflows.ts`.
 * `v0_3_4/33_workflows_become_automations/migration.ts` parses org-authored
 * standalone workflow files against `workflowJsonSchema` before wrapping them
 * into automations, so the full validation shape (not just the type) must
 * stay byte-identical. Fully self-contained — no imports beyond `zod/v4` in
 * the original, so frozen verbatim (only the `zod/v4` import is unchanged).
 */

import { z } from 'zod/v4';

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
 * round-trips as the closed render-kind vocabulary evolves.
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
      /** Operator surface: `outcome` | `process` (see SURFACES). */
      surface: z.string().optional(),
      fields: z
        .array(
          z.object({
            key: z.string().min(1),
            labelKey: z.string().min(1),
            type: z.string().min(1),
          }),
        )
        .optional(),
      // Maps a `gate` step's scalar verdict (e.g. "yes"/"no") to the label
      // shown for it, so the renderer can surface a clear verdict badge.
      verdictLabels: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

/**
 * Per-locale overrides for a STEP's user-facing `name`/`description`. Absent
 * locales fall back to the step's own literal `name`/`description` (authored
 * in English).
 */
const workflowStepI18nSchema = z.record(
  z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  }),
);

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
  /** Per-locale name/description overrides; see {@link workflowStepI18nSchema}. */
  i18n: workflowStepI18nSchema.optional(),
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
 * `wfEventSubscriptions`/`wfSchedules` rows exist.
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
 * The last KNOWN-CONSISTENT specification/graph pair: the graph fingerprint
 * and the spec-text hash as of the last sync, plus the direction that sync
 * ran in.
 */
const workflowSpecificationMetaSchema = z.object({
  sourceHash: z.string().min(1),
  /** Hash of the trimmed spec text at the last sync; absent on metas written
   *  before this field existed (then only the graph side is compared). */
  specHash: z.string().min(1).optional(),
  generatedAt: z.number().int().positive(),
  direction: z.enum(['graph_to_spec', 'spec_to_graph', 'authored']),
  model: z.string().optional(),
});

/**
 * A workflow carries NO name/description of its own — its sole identity is
 * the slug, and its sole text is the `specification`.
 */
export const workflowJsonSchema = z.object({
  version: z.string().optional(),
  config: workflowConfigSchema.optional(),
  // Documented metadata keys: `autoInstall?: boolean` (provision this
  // workflow + its declared triggers to every org), `labels?: string[]`
  // (catalog tags, e.g. ['Tasks','Automation']). Free-form record otherwise.
  metadata: z.record(z.string(), z.unknown()).optional(),
  triggers: workflowTriggersSchema.optional(),
  requires: requiresSchema.optional(),
  steps: z.array(workflowStepSchema).default([]),
  /**
   * Free-text natural-language description of the workflow, editable
   * alongside the step graph and kept bidirectionally in sync with it.
   * Optional — most workflows have no specification until a user (or the
   * assistant) generates one.
   */
  specification: z.string().max(20_000).optional(),
  specificationMeta: workflowSpecificationMetaSchema.optional(),
});

export type WorkflowJsonConfig = z.infer<typeof workflowJsonSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowStepI18n = z.infer<typeof workflowStepI18nSchema>;
export type WorkflowIntegrationDependency = z.infer<
  typeof integrationDependencySchema
>;
export type StepType = z.infer<typeof stepTypeSchema>;
