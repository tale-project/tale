'use node';

/**
 * Specification ⇄ graph sync actions (W5b).
 *
 * Both actions are PREVIEW-ONLY — neither ever writes to disk. The client
 * reviews the result (a diff for the graph direction, a draft textarea for
 * the specification direction) and commits it itself via the existing
 * `file_actions.ts::saveWorkflowWithSnapshot` (compare-and-swap on
 * `expectedHash`), same as every other workflow editor mutation.
 */

import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';
import { z } from 'zod/v4';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { components, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { getAllSyntax } from '../agent_tools/workflows/helpers/syntax_reference';
import {
  stepConfigSchema,
  workflowConfigSchema,
} from '../agent_tools/workflows/helpers/workflow_definition_schema';
import type { IntegrationCatalogEntry } from '../integrations/file_actions';
import { reasoningProviderOptionsFor } from '../lib/agent_response/reasoning/build_reasoning_options';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { renderPrompt } from '../lib/prompts/registry';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { validateWorkflowDefinition } from '../workflow_engine/helpers/validation/validate_workflow_definition';
import type { WorkflowReadResult } from './file_utils';
import { renderWorkflowOutline } from './render_workflow_outline';
import {
  computeGraphFingerprint,
  computeSpecHash,
} from './specification_fingerprint';

const MAX_RETRIES = 3;
const MAX_SPECIFICATION_LENGTH = 20_000;

function newUserId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function formatIntegrationsContext(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<string> {
  const integrations: IntegrationCatalogEntry[] = await ctx.runAction(
    internal.integrations.file_actions.listIntegrationsInternal,
    { orgSlug },
  );
  if (integrations.length === 0) {
    return 'No integrations are installed for this organization.';
  }
  return integrations
    .map((i) => `- ${i.slug}${i.title ? ` — ${i.title}` : ''}`)
    .join('\n');
}

const graphOutputSchema = z.object({
  workflowConfig: workflowConfigSchema,
  stepsConfig: z.array(stepConfigSchema),
});

/**
 * Preview: text specification → candidate graph. Reads the current file,
 * asks the model for a full `{workflowConfig, stepsConfig}` replacement,
 * validates it, and — on success — returns a candidate `WorkflowJsonConfig`
 * that preserves everything about the current file EXCEPT `steps` (name,
 * description, i18n, metadata, triggers, config all carry over unchanged),
 * with `specification` + `specificationMeta` set to record the sync. Never
 * writes to disk.
 */
export const previewGraphFromSpecification = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    specification: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      config: v.any(),
      warnings: v.optional(v.array(v.string())),
    }),
    v.object({
      ok: v.literal(false),
      errors: v.array(v.string()),
      warnings: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; config: WorkflowJsonConfig; warnings?: string[] }
    | { ok: false; errors: string[]; warnings?: string[] }
  > => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const specification = args.specification.trim();
    if (!specification) {
      return { ok: false, errors: ['The specification is empty.'] };
    }

    const current: WorkflowReadResult = await ctx.runAction(
      internal.workflows.file_actions.readWorkflowForExecution,
      { orgSlug, workflowSlug: args.workflowSlug },
    );
    if (!current.ok) {
      return {
        ok: false,
        errors: [`Workflow "${args.workflowSlug}" could not be read.`],
      };
    }
    const currentConfig = current.config;

    const integrationsContext = await formatIntegrationsContext(ctx, orgSlug);

    const instructions = renderPrompt('workflow.specification.to_graph', {
      syntaxReference: getAllSyntax().syntax,
      integrations: integrationsContext,
    });

    const { languageModel, modelData } = await resolveLanguageModelWithFallback(
      ctx,
      { tag: 'chat', organizationId: args.organizationId },
    );
    const callProviderOptions = reasoningProviderOptionsFor(
      modelData,
      buildCallProviderOptions(modelData),
      { kind: 'utility' },
    );

    const agent = new Agent(components.agent, {
      name: 'workflow-specification-to-graph',
      languageModel,
      instructions,
    });

    const userId = newUserId('wf-spec-to-graph');
    let prompt = `Workflow slug: ${args.workflowSlug}\n\nSpecification:\n${specification}`;
    let lastErrors: string[] = [];
    let lastWarnings: string[] = [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await agent.generateObject(
          ctx,
          { userId },
          {
            prompt,
            schema: graphOutputSchema,
            ...(callProviderOptions
              ? { providerOptions: callProviderOptions }
              : {}),
          },
          { storageOptions: { saveMessages: 'none' } },
        );

        const validation = validateWorkflowDefinition(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod-validated stepsConfig is Record<string, unknown>-compatible
          result.object.stepsConfig as Array<Record<string, unknown>>,
        );

        if (!validation.valid) {
          lastErrors = validation.errors;
          lastWarnings = validation.warnings;
          prompt = `${prompt}\n\nThe previous attempt failed validation:\n${validation.errors.join('\n')}\n\nFix these issues and return a corrected workflow.`;
          continue;
        }

        const candidateBase: WorkflowJsonConfig = {
          ...currentConfig,
          steps: result.object.stepsConfig.map((step, index) => ({
            stepSlug: step.stepSlug,
            name: step.name,
            stepType: step.stepType,
            config: step.config,
            nextSteps: step.nextSteps,
            order: index,
          })),
        };

        const candidate: WorkflowJsonConfig = {
          ...candidateBase,
          specification,
          specificationMeta: {
            sourceHash: computeGraphFingerprint(candidateBase),
            specHash: computeSpecHash(specification),
            generatedAt: Date.now(),
            direction: 'spec_to_graph',
            model: modelData.modelId,
          },
        };

        return {
          ok: true,
          config: workflowJsonSchema.parse(candidate),
          warnings: validation.warnings.length
            ? validation.warnings
            : undefined,
        };
      } catch (error) {
        lastErrors = [error instanceof Error ? error.message : String(error)];
        console.error(
          `[previewGraphFromSpecification] attempt ${attempt}/${MAX_RETRIES} failed:`,
          error,
        );
      }
    }

    return {
      ok: false,
      errors: lastErrors.length
        ? lastErrors
        : ['Failed to generate a workflow graph from this specification.'],
      warnings: lastWarnings.length ? lastWarnings : undefined,
    };
  },
});

/**
 * Preview: current graph → specification text. Renders a deterministic
 * markdown outline of the step graph, then asks the model to "polish" it into
 * prose that still reproduces every slug/JEXL/template/prompt verbatim. Falls
 * back to the raw outline (never fails) if the model call doesn't succeed
 * after retries — the outline is a valid, if less prose-y, specification.
 * Never writes to disk; the caller decides whether to save the result.
 */
export const previewSpecificationFromGraph = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({
    specification: v.string(),
    sourceHash: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ specification: string; sourceHash: string }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const current: WorkflowReadResult = await ctx.runAction(
      internal.workflows.file_actions.readWorkflowForExecution,
      { orgSlug, workflowSlug: args.workflowSlug },
    );
    if (!current.ok) {
      throw new Error(`Workflow "${args.workflowSlug}" could not be read.`);
    }
    const config = current.config;
    const outline = renderWorkflowOutline(args.workflowSlug, config);
    const sourceHash = computeGraphFingerprint(config);

    const { languageModel, modelData } = await resolveLanguageModelWithFallback(
      ctx,
      { tag: 'chat', organizationId: args.organizationId },
    );
    const callProviderOptions = reasoningProviderOptionsFor(
      modelData,
      buildCallProviderOptions(modelData),
      { kind: 'utility' },
    );

    const agent = new Agent(components.agent, {
      name: 'workflow-specification-from-graph',
      languageModel,
      instructions: renderPrompt('workflow.specification.from_graph'),
    });

    const userId = newUserId('wf-spec-from-graph');
    let prose: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await agent.generateText(
          ctx,
          { userId },
          {
            prompt: outline,
            ...(callProviderOptions
              ? { providerOptions: callProviderOptions }
              : {}),
          },
          { storageOptions: { saveMessages: 'none' } },
        );
        if (result.text.trim()) {
          prose = result.text.trim();
          break;
        }
      } catch (error) {
        console.error(
          `[previewSpecificationFromGraph] attempt ${attempt}/${MAX_RETRIES} failed:`,
          error,
        );
      }
    }

    const specification = (prose ?? outline).slice(0, MAX_SPECIFICATION_LENGTH);
    return { specification, sourceHash };
  },
});
