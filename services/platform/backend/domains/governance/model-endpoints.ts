import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  type ModelEndpointPolicy,
  modelEndpointPolicyOf,
} from '../../core/governance/model_endpoint_gate.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * The seams of the EU/EEA processing rule (GOV-R17): the rule as the
 * organization's model-access policy sets it, and the audit entry of a model
 * call it refused. The gate itself lives with the hosts that resolve a model
 * (`core/governance/model_endpoint_gate.ts`); every ctx-shim host that
 * resolves a provider credential answers these two names through
 * `credentialShimHandlers`.
 */

/** The organization's rule, read strictly: a missing policy is open, an
 * unreadable one refuses every call. A deployment without a config root
 * reads no provider either, so nothing there is called anyway. */
export async function readModelEndpointPolicyForOrg(
  sql: Sql,
  organizationId: string,
): Promise<ModelEndpointPolicy> {
  if (!process.env.TALE_CONFIG_DIR) return { kind: 'open' };
  try {
    return modelEndpointPolicyOf(
      await readGovernancePolicyForOrg(sql, organizationId, 'model_access', {
        strict: true,
      }),
    );
  } catch (error) {
    console.error(
      `[governance] ${organizationId}: the model access policy cannot be read, so every model call is refused until it is restored:`,
      error,
    );
    return { kind: 'unreadable' };
  }
}

const refusalArgsSchema = z.object({
  organizationId: z.string().min(1),
  surface: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().optional(),
  host: z.string().optional(),
  reason: z.string().optional(),
  code: z.string().min(1),
  message: z.string().min(1),
  actor: z
    .object({
      id: z.string().min(1),
      type: z.enum(['user', 'api', 'workflow', 'system']),
    })
    .optional(),
});

export type ModelEndpointRefusalRecord = z.infer<typeof refusalArgsSchema>;

/** Write the audit entry of a refused model call: who asked, from which
 * surface, for which provider and model, and why it was not sent. */
export async function recordModelEndpointRefusal(
  sql: Sql,
  record: ModelEndpointRefusalRecord,
): Promise<void> {
  await sql.begin((tx) =>
    createAuditLog(tx, {
      organizationId: record.organizationId,
      actorId: record.actor?.id ?? 'system',
      actorType: record.actor?.type ?? 'system',
      action: 'model_access.denied',
      category: 'security',
      resourceType: 'provider',
      resourceId: record.provider,
      resourceName: record.provider,
      status: 'denied',
      errorMessage: record.message,
      metadata: {
        rule: 'eu_processing',
        surface: record.surface,
        code: record.code,
        ...(record.model !== undefined ? { model: record.model } : {}),
        ...(record.host !== undefined ? { host: record.host } : {}),
        ...(record.reason !== undefined ? { reason: record.reason } : {}),
      },
    }),
  );
}

export function modelEndpointShimHandlers(sql: Sql): ShimHandlers {
  return {
    'governance/internal_queries:getModelEndpointPolicyInternal': (raw) =>
      readModelEndpointPolicyForOrg(
        sql,
        z.object({ organizationId: z.string().min(1) }).parse(raw)
          .organizationId,
      ),
    'governance/internal_mutations:recordModelEndpointRefusal': async (raw) => {
      await recordModelEndpointRefusal(sql, refusalArgsSchema.parse(raw));
      return null;
    },
  };
}
