'use node';

// Per-workflow + per-step env/secrets — Node actions. Encryption + decryption
// live here because `lib/crypto` is node-only.
//
//  - setWorkflowEnvVar: public write path. Authenticates, asserts org
//    membership, validates, encrypts secrets, then stores via the internal
//    mutation. Secrets are write-only — no read-back path exists.
//  - resolveSandboxEnvForStep: internal, called at sandbox-step execution. Reads
//    the workflow-level + step-level rows, decrypts secrets, and returns the two
//    env maps for the engine to merge (step over workflow) and inject into the
//    run's sandbox (decrypt-at-run; ciphertext never leaves the server except as
//    the resolved value over the in-cluster injection channel).

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { decryptString } from '../lib/crypto/decrypt_string';
import { encryptString } from '../lib/crypto/encrypt_string';
import {
  maskSecretPreview,
  validateEnvKey,
  validateEnvValue,
} from '../sandbox/user_env_constants';

export const setWorkflowEnvVar = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    // '' = workflow-level (all sandbox steps); non-empty = that step only.
    stepSlug: v.string(),
    key: v.string(),
    value: v.string(),
    isSecret: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Org-membership is the edit gate (configuring a workflow is privileged,
    // org-shared) — throws ConvexError if the caller is not a member.
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);

    const keyCheck = validateEnvKey(args.key);
    if (!keyCheck.ok) {
      throw new ConvexError({ code: 'invalid', message: keyCheck.reason });
    }
    // Trim surrounding whitespace — a pasted token commonly carries a trailing
    // newline that silently corrupts it. Interior whitespace is left intact.
    const value = args.value.trim();
    const valueCheck = validateEnvValue(value);
    if (!valueCheck.ok) {
      throw new ConvexError({ code: 'invalid', message: valueCheck.reason });
    }
    if (args.isSecret && value.length === 0) {
      throw new ConvexError({
        code: 'invalid',
        message: 'Secret value must not be empty.',
      });
    }

    const encryptedValue = args.isSecret
      ? await encryptString(value)
      : undefined;
    const maskedPreview = args.isSecret ? maskSecretPreview(value) : undefined;

    await ctx.runMutation(
      internal.workflows.workflow_env.upsertWorkflowEnvInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        stepSlug: args.stepSlug,
        key: args.key,
        isSecret: args.isSecret,
        ...(args.isSecret ? {} : { value }),
        ...(encryptedValue !== undefined && { encryptedValue }),
        ...(maskedPreview !== undefined && { maskedPreview }),
        updatedBy: userId,
      },
    );
    return null;
  },
});

export const resolveSandboxEnvForStep = internalAction({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    stepSlug: v.string(),
  },
  returns: v.object({
    workflowEnv: v.record(v.string(), v.string()),
    stepEnv: v.record(v.string(), v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    workflowEnv: Record<string, string>;
    stepEnv: Record<string, string>;
  }> => {
    const { workflow, step } = await ctx.runQuery(
      internal.workflows.workflow_env.listWorkflowEnvForInjection,
      {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        stepSlug: args.stepSlug,
      },
    );

    const resolve = async (
      rows: Array<{
        key: string;
        isSecret: boolean;
        value?: string;
        encryptedValue?: string;
      }>,
    ): Promise<Record<string, string>> => {
      const env: Record<string, string> = {};
      for (const row of rows) {
        if (row.isSecret) {
          if (row.encryptedValue === undefined) continue;
          try {
            env[row.key] = await decryptString(row.encryptedValue);
          } catch (err) {
            // A corrupt secret / rotated key must not abort the run — skip it.
            console.warn(
              `[workflow-env] secret '${row.key}' failed to decrypt:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        } else {
          env[row.key] = row.value ?? '';
        }
      }
      return env;
    };

    return {
      workflowEnv: await resolve(workflow),
      stepEnv: await resolve(step),
    };
  },
});
