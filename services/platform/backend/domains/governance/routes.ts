import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  collectAllApplicableRules,
  collectWarnings,
  resolveEffectiveLimits,
  type BudgetWarning,
} from '../../../convex/governance/budget_enforcement.ts';
import { buildPeriodKey } from '../../../convex/governance/helpers.ts';
import { isAdmin } from '../../../convex/lib/rls/helpers/role_helpers.ts';
import {
  isFilePolicyType,
  POLICY_SCHEMAS,
} from '../../../lib/shared/schemas/governance.ts';
import type { Auth } from '../../auth/auth.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { checkTtsBudget } from '../tts/service.ts';
import {
  getAccessibleModelsForUser,
  resolveFeatureFlagsForUser,
} from './service.ts';
import {
  listTrashedRows,
  restoreSoftDeletedRow,
  TrashError,
  type TrashCursor,
} from './trash.ts';

/**
 * /api/app/governance — the governance SETTINGS core: policy file
 * reads/writes (history-snapshotted yaml, the 0.4 `saveGovernancePolicy`
 * semantics), the caller's resolved feature flags and budget status, the
 * model-access filter, and the admin Trash listing/restore.
 */

/** The 0.4 member-readable set — everything else needs admin. */
const POLICY_TYPES_READABLE_BY_MEMBER: ReadonlySet<string> = new Set([
  'data_classification_notice',
  'feature_flags',
  'pii_config',
  'chat_filter',
  'custom_instructions',
  'user_memories',
  'upload_policy',
  'default_models',
  'session_idle_timeout',
]);

/** Types with dedicated write actions (bounds / grace flows) — never
 * writable through the generic save door. */
const SPECIAL_WRITE_POLICY_TYPES: ReadonlySet<string> = new Set([
  'retention_policy',
  'dsar_governance',
]);

export function createGovernanceRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/policies/:policyType', async (c) => {
    const policyType = c.req.param('policyType');
    if (!isFilePolicyType(policyType)) {
      return c.json({ error: 'UNKNOWN_POLICY_TYPE' }, 400);
    }
    if (
      !POLICY_TYPES_READABLE_BY_MEMBER.has(policyType) &&
      !isAdmin(c.get('orgMember').role)
    ) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const config = await readGovernancePolicyForOrg(
      deps.sql,
      c.get('orgId'),
      policyType,
    );
    return c.json({
      policy: config === null ? null : { key: policyType, config },
    });
  });

  app.post('/policies/:policyType', async (c) => {
    const policyType = c.req.param('policyType');
    if (!isFilePolicyType(policyType)) {
      return c.json({ error: 'UNKNOWN_POLICY_TYPE' }, 400);
    }
    if (SPECIAL_WRITE_POLICY_TYPES.has(policyType)) {
      return c.json(
        {
          error: 'use_special_action',
          message: `${policyType} has a dedicated write door.`,
        },
        400,
      );
    }
    if (!isAdmin(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = POLICY_SCHEMAS[policyType].safeParse(
      body !== null && typeof body === 'object' && 'config' in body
        ? body.config
        : body,
    );
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation',
          message: `Invalid ${policyType} configuration: ${parsed.error.message}`,
        },
        400,
      );
    }
    const organizationId = c.get('orgId');
    const orgSlug = await resolveOrgSlug(deps.sql, organizationId);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const previous = await readGovernancePolicyForOrg(
      deps.sql,
      organizationId,
      policyType,
    );
    const { writeGovernancePolicyFile } =
      await import('../../lib/governance-policy-write.ts');
    await writeGovernancePolicyFile(orgSlug, policyType, parsed.data);
    const session = c.get('sessionBundle');
    await transactSerializable(deps.sql, async (tx) => {
      await createAuditLog(tx, {
        organizationId,
        actorId: session.user.id,
        actorEmail: session.user.email,
        actorType: 'user',
        action:
          previous === null
            ? 'governance_policy.created'
            : 'governance_policy.updated',
        category: 'security',
        resourceType: 'governance_policy',
        resourceId: policyType,
        ...(previous !== null ? { previousState: { config: previous } } : {}),
        newState: { config: parsed.data },
        status: 'success',
      });
      await emitHintInTx(tx, {
        orgId: organizationId,
        entity: 'governance_policy',
        entityId: policyType,
      });
    });
    return c.json({ ok: true });
  });

  app.get('/my/feature-flags', async (c) => {
    const flags = await resolveFeatureFlagsForUser(deps.sql, {
      organizationId: c.get('orgId'),
      userId: c.get('sessionBundle').user.id,
    });
    // The composer's pre-send gate: any enabled input guardrail policy.
    const guardrails = await Promise.all(
      (['chat_filter', 'pii_config', 'moderation_provider'] as const).map(
        (key) => readGovernancePolicyForOrg(deps.sql, c.get('orgId'), key),
      ),
    );
    const inputGuardrailsActive = guardrails.some(
      (policy) =>
        policy !== null && (policy as { enabled?: unknown }).enabled !== false,
    );
    return c.json({ flags: { ...flags, inputGuardrailsActive } });
  });

  app.get('/my/budget-status', async (c) => {
    const organizationId = c.get('orgId');
    const userId = c.get('sessionBundle').user.id;
    const role = c.get('orgMember').role;
    const allTeamIds = await getUserTeamIds(deps.sql, userId);
    const full = await checkTtsBudget(deps.sql, {
      organizationId,
      userId,
      userTeamIds: allTeamIds,
      userRole: role,
      prospectiveCostCents: 0,
      prospectiveRequests: 0,
    });
    if (!full.allowed) {
      return c.json({
        status: {
          exceeded: true,
          code: full.code ?? null,
          period: full.period ?? null,
          used: full.used ?? null,
          limit: full.limit ?? null,
          reason: full.reason ?? null,
          warnings: null,
        },
      });
    }
    // Warnings scoped to the selected team context (the 0.4 display rule).
    const selectedTeamId = c.req.query('selectedTeamId');
    const displayTeamIds =
      selectedTeamId !== undefined && allTeamIds.includes(selectedTeamId)
        ? [selectedTeamId]
        : [];
    const config = await readGovernancePolicyForOrg(
      deps.sql,
      organizationId,
      'budgets',
    );
    if (!config || !config.enabled || config.rules.length === 0) {
      return c.json({ status: null });
    }
    const applicable = collectAllApplicableRules(
      config.rules,
      userId,
      displayTeamIds,
      role,
      undefined,
    );
    const warnings: BudgetWarning[] = [];
    for (const period of new Set(applicable.map((rule) => rule.period))) {
      const periodRules = applicable.filter((r) => r.period === period);
      const limits = resolveEffectiveLimits(
        periodRules,
        userId,
        displayTeamIds,
        role,
        undefined,
      );
      const periodKey = buildPeriodKey(period);
      const usage = await deps.sql<
        { totalTokens: number; costEstimate: number; requestCount: number }[]
      >`
        SELECT coalesce(sum(total_tokens), 0)::float8 AS "totalTokens",
               coalesce(sum(cost_estimate_cents), 0)::float8 AS "costEstimate",
               coalesce(sum(request_count), 0)::float8 AS "requestCount"
        FROM app.usage_ledger
        WHERE org_id = ${organizationId} AND period_key = ${periodKey}
          AND user_id = ${userId}
      `;
      warnings.push(
        ...collectWarnings(
          limits,
          usage[0] ?? { totalTokens: 0, costEstimate: 0, requestCount: 0 },
          period,
        ),
      );
    }
    if (warnings.length > 0) {
      return c.json({
        status: {
          exceeded: false,
          code: null,
          period: null,
          used: null,
          limit: null,
          reason: null,
          warnings,
        },
      });
    }
    return c.json({ status: null });
  });

  app.post('/models/accessible', async (c) => {
    const body = z
      .object({ modelIds: z.array(z.string().max(200)).max(500) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    return c.json({
      models: await getAccessibleModelsForUser(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        modelIds: body.data.modelIds,
      }),
    });
  });

  const requireAdmin = (c: Context<OrgEnv>): Response | null =>
    isAdmin(c.get('orgMember').role)
      ? null
      : c.json({ error: 'FORBIDDEN' }, 403);

  app.get('/trash', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const typesParam = c.req.query('resourceTypes');
    const cursorParam = c.req.query('cursor');
    let cursor: TrashCursor | null = null;
    if (cursorParam !== undefined && cursorParam !== '') {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(cursorParam, 'base64url').toString('utf8'),
        );
        const check = z
          .object({
            resourceType: z.string(),
            statusChangedAt: z.number(),
            id: z.string(),
          })
          .safeParse(parsed);
        if (check.success) cursor = check.data;
      } catch (error) {
        console.warn('[governance] bad trash cursor ignored:', error);
      }
    }
    const limitParam = Number(c.req.query('limit') ?? '50');
    const result = await listTrashedRows(deps.sql, c.get('orgId'), {
      ...(typesParam !== undefined && typesParam !== ''
        ? { resourceTypes: typesParam.split(',') }
        : {}),
      cursor,
      limit: Number.isFinite(limitParam) ? limitParam : 50,
    });
    return c.json({
      rows: result.rows,
      nextCursor:
        result.nextCursor === null
          ? null
          : Buffer.from(JSON.stringify(result.nextCursor), 'utf8').toString(
              'base64url',
            ),
    });
  });

  app.post('/trash/restore', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = z
      .object({ resourceType: z.string().min(1), id: z.string().min(1) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        restoreSoftDeletedRow(
          tx,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            email: session.user.email,
          },
          body.data,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof TrashError) {
        return c.json({ error: error.code }, error.status);
      }
      throw error;
    }
  });

  return app;
}
