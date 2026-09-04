import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { retentionPolicyConfigSchema } from '../../../lib/shared/schemas/governance.ts';
import {
  hashAppliedBounds,
  RETENTION_CATEGORIES,
} from '../../../lib/shared/schemas/retention.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  buildImpactPreview,
  diffBounds,
} from '../../core/governance/retention_bounds_proposal.ts';
import {
  assertWithinBounds,
  buildBoundsByCategory,
  RetentionBoundsViolation,
  applyEnvTighteningAll,
  isRetentionDisabled,
  RETENTION_POLICY_FIELD_BY_CATEGORY,
  RetentionConfigMissingError,
} from '../../core/governance/retention_floors.ts';
import { writeGovernancePolicyFile } from '../../lib/governance-policy-write.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  cancelPendingRetentionChange,
  getPendingRetentionChange,
  GovernanceTailError,
  stageRetentionShortening,
} from '../governance/settings-tail.ts';
import {
  applyRetentionBounds,
  computeEffectiveAppliedBounds,
  getAppliedBounds,
  loadOrgRetentionConfig,
  RetentionError,
  setRejectedBoundsHash,
} from './service.ts';

/** /api/app/retention — the admin bounds surface: what is applied, and the
 * Apply gesture that snapshots the current file × env bounds. */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof RetentionError || error instanceof GovernanceTailError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof RetentionBoundsViolation) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        data: {
          category: error.category,
          requested: error.requested,
          bound: error.bound,
          source: error.source,
        },
      },
      400,
    );
  }
  throw error;
}

export function createRetentionRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.use(async (c, next) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin role required' }, 403);
    }
    return next();
  });

  app.get('/bounds', async (c) => {
    return c.json({
      applied: await getAppliedBounds(deps.sql, c.get('orgId')),
    });
  });

  /** The operator bounds catalog the retention editor renders (the 0.4
   * `getRetentionBoundsAction`: file x env tightening; empty bounds are
   * the expected fresh-org state, not an error). */
  app.get('/bounds/catalog', async (c) => {
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const orgConfig = await loadOrgRetentionConfig(orgSlug);
    if (!orgConfig) {
      return c.json({ bounds: [], retentionDisabled: isRetentionDisabled() });
    }
    try {
      return c.json({
        bounds: applyEnvTighteningAll(orgConfig),
        retentionDisabled: isRetentionDisabled(),
      });
    } catch (error) {
      if (error instanceof RetentionConfigMissingError) {
        return c.json(
          {
            error: 'RETENTION_CONFIG_MISSING',
            category: error.category,
            message: error.message,
          },
          400,
        );
      }
      throw error;
    }
  });

  app.post('/bounds/apply', async (c) => {
    const body = z
      .object({ proposedHash: z.string().min(1).max(200).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      // OCC against the operator config the admin reviewed (the 0.4
      // `applyBoundsProposal` STALE_PROPOSAL guard).
      if (body.data.proposedHash !== undefined) {
        const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
        if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
        const liveHash = await hashAppliedBounds(
          await computeEffectiveAppliedBounds(orgSlug),
        );
        if (liveHash !== body.data.proposedHash) {
          return c.json(
            {
              error: 'STALE_PROPOSAL',
              message:
                'Operator config changed while you were reviewing. Refresh the editor to see the new proposal.',
              liveHash,
            },
            409,
          );
        }
      }
      return c.json({
        bounds: await applyRetentionBounds(deps.sql, {
          organizationId: c.get('orgId'),
          actorId: c.get('sessionBundle').user.id,
          actorEmail: c.get('sessionBundle').user.email,
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** The admin's retention-policy save (the 0.4 `upsertRetentionPolicyAction`
   * bounds validation + the 7-day shortening cooldown). */
  app.post('/policy', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = retentionPolicyConfigSchema.safeParse(
      body !== null && typeof body === 'object' && 'config' in body
        ? body.config
        : body,
    );
    if (!parsed.success) {
      return c.json(
        { error: 'validation', message: parsed.error.message },
        400,
      );
    }
    const organizationId = c.get('orgId');
    const orgSlug = await resolveOrgSlug(deps.sql, organizationId);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      const orgConfig = await loadOrgRetentionConfig(orgSlug);
      if (!orgConfig) {
        return c.json(
          {
            error: 'RETENTION_CONFIG_MISSING',
            message: `Retention config not yet installed for ${orgSlug}.`,
          },
          400,
        );
      }
      const boundsByCategory = buildBoundsByCategory(orgConfig);
      const cfg = parsed.data;
      // Every bounded category, from the ONE field↔category map — a hand
      // list here once omitted `agentRuns`, so its value bypassed the floor
      // the sweep would then delete by.
      for (const category of RETENTION_CATEGORIES) {
        const value = cfg[RETENTION_POLICY_FIELD_BY_CATEGORY[category]];
        if (typeof value !== 'number') continue;
        assertWithinBounds(boundsByCategory[category], value);
      }
      const oldConfig = await readGovernancePolicyForOrg(
        deps.sql,
        organizationId,
        'retention_policy',
      );
      await writeGovernancePolicyFile(orgSlug, 'retention_policy', cfg);
      const session = c.get('sessionBundle');
      await transactSerializable(deps.sql, async (tx) => {
        if (oldConfig !== null) {
          await stageRetentionShortening(
            tx,
            {
              organizationId,
              userId: session.user.id,
              email: session.user.email,
            },
            oldConfig,
            cfg,
          );
        }
        await createAuditLog(tx, {
          organizationId,
          actorId: session.user.id,
          actorEmail: session.user.email,
          actorType: 'user',
          action:
            oldConfig === null
              ? 'governance_policy.created'
              : 'governance_policy.updated',
          category: 'security',
          resourceType: 'governance_policy',
          resourceId: 'retention_policy',
          ...(oldConfig !== null
            ? { previousState: { config: oldConfig } }
            : {}),
          newState: { config: cfg },
          status: 'success',
        });
        await emitHintInTx(tx, {
          orgId: organizationId,
          entity: 'governance_policy',
          entityId: 'retention_policy',
        });
      });
      // First-enable seed: an org saving its first policy applies the
      // current operator bounds implicitly (the 0.4 idempotent seed).
      if ((await getAppliedBounds(deps.sql, organizationId)) === null) {
        await applyRetentionBounds(deps.sql, {
          organizationId,
          actorId: session.user.id,
          actorEmail: session.user.email,
        });
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/pending-change', async (c) => {
    return c.json({
      pending: await getPendingRetentionChange(deps.sql, c.get('orgId')),
    });
  });

  app.post('/pending-change/cancel', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await cancelPendingRetentionChange(deps.sql, {
        organizationId: c.get('orgId'),
        userId: session.user.id,
        email: session.user.email,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** The bounds banner's read: effective file × env bounds vs the applied
   * snapshot (the 0.4 `getPendingBoundsProposal`). */
  app.get('/bounds/proposal', async (c) => {
    const organizationId = c.get('orgId');
    const orgSlug = await resolveOrgSlug(deps.sql, organizationId);
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      const proposedBounds = await computeEffectiveAppliedBounds(orgSlug);
      const proposedHash = await hashAppliedBounds(proposedBounds);
      const applied = await getAppliedBounds(deps.sql, organizationId);
      if (applied !== null) {
        const appliedHash = await hashAppliedBounds(applied.bounds);
        if (
          appliedHash === proposedHash ||
          applied.rejectedBoundsHash === proposedHash
        ) {
          return c.json({ proposal: null });
        }
      }
      const orgPolicy = await readGovernancePolicyForOrg(
        deps.sql,
        organizationId,
        'retention_policy',
      );
      return c.json({
        proposal: {
          firstApply: applied === null,
          proposedBounds,
          proposedHash,
          appliedBounds: applied?.bounds ?? null,
          diff: diffBounds(applied?.bounds ?? null, proposedBounds),
          impactPreview: buildImpactPreview(
            proposedBounds,
            orgPolicy ?? undefined,
          ),
        },
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Silence the banner for exactly this operator hash. */
  app.post('/bounds/reject', async (c) => {
    const body = z
      .object({ proposedHash: z.string().min(1).max(200) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const stamped = await setRejectedBoundsHash(
      deps.sql,
      c.get('orgId'),
      body.data.proposedHash,
    );
    if (!stamped) {
      return c.json(
        { error: 'NO_APPLIED_BOUNDS', message: 'Apply bounds first.' },
        400,
      );
    }
    return c.json({ ok: true });
  });

  return app;
}
