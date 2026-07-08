// Per-workflow + per-step env/secrets — V8 table + mutations/queries.
//
// Scope: one row per (organizationId, workflowSlug, stepSlug, key). `stepSlug:''`
// is the WORKFLOW-level scope (auto-injected into every sandbox step of the
// workflow); a non-empty `stepSlug` is STEP-level (that step only). Plain vars
// carry a plaintext `value`; secrets carry an `encryptedValue` (JWE) and are
// write-only — the read API never returns a secret's plaintext. Resolved at
// sandbox-step execution (decrypt-at-run) and injected into the run's sandbox.
// Mirrors `agents/agent_env`; encryption lives in the Node action
// `workflow_env_actions.ts`.

import { ConvexError, v } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { SECRET_MASK } from '../sandbox/user_env_constants';

/** Guardrail on the number of env/secret entries per (workflow, scope). */
export const MAX_ENV_VARS_PER_WORKFLOW_SCOPE = 100;

/** Assert the caller is a live member of the org (the edit gate — configuring a
 *  workflow is already a privileged, org-shared action). */
async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<void> {
  const authUser = await requireAuthenticatedUser(ctx);
  await getOrganizationMember(ctx, organizationId, { userId: authUser.userId });
}

/**
 * Upsert one workflow env/secret row. Internal — the public entry is the Node
 * action `setWorkflowEnvVar`, which authenticates, validates, and (for secrets)
 * encrypts before calling this. Enforces the per-scope count cap on inserts.
 */
export const upsertWorkflowEnvInternal = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    stepSlug: v.string(),
    key: v.string(),
    isSecret: v.boolean(),
    value: v.optional(v.string()),
    encryptedValue: v.optional(v.string()),
    maskedPreview: v.optional(v.string()),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow_step_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug)
          .eq('stepSlug', args.stepSlug)
          .eq('key', args.key),
      )
      .first();

    const now = Date.now();
    const fields = {
      isSecret: args.isSecret,
      // Exactly one of value / encryptedValue is set; clear the other so a
      // secret↔non-secret flip never leaves a stale field. The masked preview
      // exists only for secrets.
      value: args.isSecret ? undefined : args.value,
      encryptedValue: args.isSecret ? args.encryptedValue : undefined,
      maskedPreview: args.isSecret ? args.maskedPreview : undefined,
      updatedAt: now,
      updatedBy: args.updatedBy,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return null;
    }

    const count = (
      await ctx.db
        .query('workflowEnv')
        .withIndex('by_org_workflow_step', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('workflowSlug', args.workflowSlug)
            .eq('stepSlug', args.stepSlug),
        )
        .collect()
    ).length;
    if (count >= MAX_ENV_VARS_PER_WORKFLOW_SCOPE) {
      throw new ConvexError({
        code: 'too_many',
        message: `A workflow scope can have at most ${MAX_ENV_VARS_PER_WORKFLOW_SCOPE} environment variables.`,
      });
    }

    await ctx.db.insert('workflowEnv', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      stepSlug: args.stepSlug,
      key: args.key,
      ...fields,
    });
    return null;
  },
});

/**
 * Raw rows for injection (the Node `resolveSandboxEnvForStep` action decrypts
 * secrets). Internal-only — returns ciphertext, never exposed to the browser.
 * Returns BOTH the workflow-level (`stepSlug:''`) and the given step's rows so a
 * single round-trip covers the whole merge.
 */
export const listWorkflowEnvForInjection = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    stepSlug: v.string(),
  },
  returns: v.object({
    workflow: v.array(
      v.object({
        key: v.string(),
        isSecret: v.boolean(),
        value: v.optional(v.string()),
        encryptedValue: v.optional(v.string()),
      }),
    ),
    step: v.array(
      v.object({
        key: v.string(),
        isSecret: v.boolean(),
        value: v.optional(v.string()),
        encryptedValue: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .collect();
    const toEntry = (r: (typeof rows)[number]) => {
      const entry: {
        key: string;
        isSecret: boolean;
        value?: string;
        encryptedValue?: string;
      } = { key: r.key, isSecret: r.isSecret };
      if (r.value !== undefined) entry.value = r.value;
      if (r.encryptedValue !== undefined)
        entry.encryptedValue = r.encryptedValue;
      return entry;
    };
    return {
      workflow: rows.filter((r) => r.stepSlug === '').map(toEntry),
      // A step-level lookup with stepSlug:'' would duplicate the workflow set;
      // only collect step rows when a real step slug is asked for.
      step:
        args.stepSlug === ''
          ? []
          : rows.filter((r) => r.stepSlug === args.stepSlug).map(toEntry),
    };
  },
});

/**
 * List one scope's env/secrets for the inline editor. Secrets are write-only:
 * plaintext is never returned — `value` is present only for non-secret vars;
 * secrets carry a fixed mask. `stepSlug:''` lists the workflow-level scope.
 */
export const listWorkflowEnv = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    stepSlug: v.string(),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      isSecret: v.boolean(),
      value: v.optional(v.string()),
      maskedValue: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow_step', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug)
          .eq('stepSlug', args.stepSlug),
      )
      .collect();
    return rows
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => {
        const entry: {
          key: string;
          isSecret: boolean;
          value?: string;
          maskedValue?: string;
          updatedAt: number;
        } = { key: r.key, isSecret: r.isSecret, updatedAt: r.updatedAt };
        // Secrets show a low-leak edge preview (older rows without one fall
        // back to the full mask); plaintext vars show their value.
        if (r.isSecret) entry.maskedValue = r.maskedPreview ?? SECRET_MASK;
        else entry.value = r.value ?? '';
        return entry;
      });
  },
});

/** Delete one env/secret entry from a scope. */
export const deleteWorkflowEnvVar = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    stepSlug: v.string(),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId);
    const existing = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow_step_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug)
          .eq('stepSlug', args.stepSlug)
          .eq('key', args.key),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Delete every env/secret entry for a workflow (all scopes). Internal — called
 * when the workflow file is deleted so its env never outlives it.
 */
export const deleteWorkflowEnvInternal = internalMutation({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Delete every env/secret entry for an installed automation's workflow(s).
 * Internal — called by automation uninstall. An automation's single workflow
 * now lives INLINE and its slug IS the automation slug (bare), so sweep the
 * EXACT bare slug; ALSO sweep the legacy `<automationSlug>/` scoped namespace (a
 * prior version's `<slug>/<name>` workflow env would otherwise orphan and
 * silently reattach on a later reinstall). A sibling automation
 * (`<automationSlug>-2`) sorts outside both. Mirrors
 * `agents/agent_env.ts::deleteAutomationAgentEnvInternal`.
 */
export const deleteAutomationWorkflowEnvInternal = internalMutation({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The inline workflow, keyed by the bare automation slug.
    const exactRows = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.automationSlug),
      )
      .collect();
    // Legacy scoped namespace `<automationSlug>/…`. Exclusive upper bound = the
    // code point right after '/' (0x2F -> 0x30), so ['<app>/', '<app>' + next)
    // is exactly this automation's old scoped workflows.
    const prefix = `${args.automationSlug}/`;
    const prefixEnd = `${args.automationSlug}${String.fromCharCode(
      '/'.charCodeAt(0) + 1,
    )}`;
    const scopedRows = await ctx.db
      .query('workflowEnv')
      .withIndex('by_org_workflow', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('workflowSlug', prefix)
          .lt('workflowSlug', prefixEnd),
      )
      .collect();
    for (const row of [...exactRows, ...scopedRows]) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
