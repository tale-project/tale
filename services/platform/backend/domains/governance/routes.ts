import { transactSerializable } from '@tale/shared/db/serializable';
import { epochMsSchema } from '@tale/shared/schemas/epoch-ms';
import { dsarGovernanceConfigSchema } from '@tale/shared/schemas/governance';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { mayCreateApiKeys } from '../../auth/api-key-create-gate.ts';
import type { Auth } from '../../auth/auth.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  collectStandingWarnings,
  type BudgetWarning,
} from '../../core/governance/budget_enforcement.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { isAdmin } from '../../core/lib/rls/helpers/role_helpers.ts';
import { appErrorHandler } from '../../error-reporting';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import { projectChatAccess } from '../chat/threads.ts';
import { ContactError } from '../contacts/service.ts';
import { syncRagDocumentScope } from '../knowledge/service.ts';
import { readModelApiStanding } from '../model_api/access.ts';
import { listModelApiModels } from '../model_api/models.ts';
import {
  describeRuleApiKeys,
  holdsApiKeys,
  listOrgApiKeys,
} from './api-keys.ts';
import {
  findBudgetViolation,
  loadBudgetSubject,
  readBudgetStanding,
} from './budget-gate.ts';
import { readInFlightReservations } from './budget-reservations.ts';
import {
  CompetenceError,
  grantCompetence,
  listOrgCompetences,
  listUserCompetences,
  revokeCompetence,
} from './competence.ts';
import { testModerationProvider } from './moderation.ts';
import {
  assertGovernancePolicyReadable,
  GovernancePolicyError,
  readGovernancePolicySnapshotFor,
  saveGovernancePolicy,
} from './policy-writer.ts';
import {
  cancelPendingDsarPolicyChange,
  getDsarPolicyForUi,
  GovernanceTailError,
  listRecentChatFilterEvents,
  MODERATION_SECRET_NAME,
  proposeDsarPolicy,
  saveGovernanceSecret,
  readGovernanceSecretMasked,
  getGuardrailStats,
} from './settings-tail.ts';
import {
  listTrashedRows,
  restoreSoftDeletedRow,
  TrashError,
  type TrashCursor,
} from './trash.ts';
import { getOrgUsageMetricsPg } from './usage-metrics.ts';

/**
 * /api/app/governance — the governance SETTINGS core: policy file
 * reads/writes (history-snapshotted yaml, through the policy writer in
 * `policy-writer.ts`, which holds who may read and change each policy), the
 * caller's resolved feature flags, budget status and budget usage, the
 * model-access filter, and the admin Trash listing/restore.
 */

export function createGovernanceRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.onError((error, c) => {
    if (error instanceof ConfigurationError)
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    return appErrorHandler(error, c);
  });

  /** A policy refusal as the door answers it: the code and status, with
   * the sentence and data the refusal carries on the wire. */
  const policyErrorResponse = (c: Context<OrgEnv>, error: unknown) => {
    if (error instanceof GovernancePolicyError) {
      return c.json(
        {
          error: error.code,
          ...(error.answersMessage ? { message: error.message } : {}),
          ...(error.data !== undefined ? { data: error.data } : {}),
        },
        error.status,
      );
    }
    throw error;
  };

  app.get('/policies/:policyType', async (c) => {
    const member = {
      organizationId: c.get('orgId'),
      role: c.get('orgMember').role,
    };
    try {
      if (c.req.query('includeHash') === '1') {
        return c.json(
          await readGovernancePolicySnapshotFor(
            deps.sql,
            member,
            c.req.param('policyType'),
          ),
        );
      }
      const policyType = assertGovernancePolicyReadable(
        member.role,
        c.req.param('policyType'),
      );
      const config = await readGovernancePolicyForOrg(
        deps.sql,
        member.organizationId,
        policyType,
        policyType === 'transcription_model' ||
          policyType === 'image_generation' ||
          policyType === 'standard_agent'
          ? { strict: true }
          : {},
      );
      return c.json({
        policy: config === null ? null : { key: policyType, config },
      });
    } catch (error) {
      return policyErrorResponse(c, error);
    }
  });

  app.post('/policies/:policyType', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const fields = body !== null && typeof body === 'object' ? body : null;
    const user = c.get('sessionBundle').user;
    try {
      await saveGovernancePolicy(
        deps.sql,
        {
          organizationId: c.get('orgId'),
          userId: user.id,
          email: user.email,
          role: c.get('orgMember').role,
        },
        c.req.param('policyType'),
        {
          config: fields !== null && 'config' in fields ? fields.config : body,
          expectedHash:
            fields !== null && 'expectedHash' in fields
              ? fields.expectedHash
              : undefined,
        },
      );
    } catch (error) {
      return policyErrorResponse(c, error);
    }
    return c.json({ ok: true });
  });

  /** The caller as the competence writer's actor (role decides the gate;
   * the refusal itself is audited inside the service). */
  const actorOf = (
    c: Context<OrgEnv>,
  ): { userId: string; email?: string; role: string } => {
    const user = c.get('sessionBundle').user;
    return {
      userId: user.id,
      ...(user.email ? { email: user.email } : {}),
      role: c.get('orgMember').role,
    };
  };

  const competenceError = (c: Context<OrgEnv>, error: unknown): Response => {
    if (error instanceof CompetenceError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
    throw error;
  };

  /**
   * Competence register — who is qualified to respond to a governed review.
   * Reads are org-member (a responder must be able to see why they were
   * refused); grants and revocations are admin-only and audited, including
   * the refusal of a non-admin attempt.
   */
  app.get('/competences', async (c) => {
    const userId = c.req.query('userId');
    return c.json({
      records:
        userId === undefined || userId === ''
          ? await listOrgCompetences(deps.sql, c.get('orgId'))
          : await listUserCompetences(deps.sql, c.get('orgId'), userId),
    });
  });

  app.post('/competences', async (c) => {
    const body = z
      .object({
        userId: z.string().min(1).max(128),
        competence: z.string().min(1).max(200),
        expiresAt: epochMsSchema.optional(),
        evidence: z.string().max(4000).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      return c.json(
        await grantCompetence(deps.sql, {
          organizationId: c.get('orgId'),
          actor: actorOf(c),
          userId: body.data.userId,
          competence: body.data.competence,
          ...(body.data.expiresAt !== undefined
            ? { expiresAt: body.data.expiresAt }
            : {}),
          ...(body.data.evidence !== undefined
            ? { evidence: body.data.evidence }
            : {}),
        }),
        201,
      );
    } catch (error) {
      return competenceError(c, error);
    }
  });

  app.post('/competences/:recordId/revoke', async (c) => {
    try {
      await revokeCompetence(deps.sql, {
        organizationId: c.get('orgId'),
        actor: actorOf(c),
        recordId: c.req.param('recordId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return competenceError(c, error);
    }
  });

  /** The API keys of this organization's members, masked — the budget
   * editor's per-key picker. Admin only, like writing the budget rules; an
   * admin's own key listing (`/api/auth/api-key/list`) shows only theirs.
   * `ruleKeys` describes the keys the saved budget rules name that are no
   * longer in that listing — expired, disabled, revoked, or held by someone
   * who left — so the rule table names each by key and owner, never by a
   * bare id. */
  app.get('/api-keys', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const organizationId = c.get('orgId');
    const keys = await listOrgApiKeys(deps.sql, organizationId);
    const listed = new Set(keys.map((key) => key.id));
    const budgets = await readGovernancePolicyForOrg(
      deps.sql,
      organizationId,
      'budgets',
    );
    const ruleKeyIds = (budgets?.rules ?? []).flatMap((rule) =>
      rule.scope === 'apiKey' &&
      rule.apiKeyId !== undefined &&
      rule.apiKeyId !== '' &&
      !listed.has(rule.apiKeyId)
        ? [rule.apiKeyId]
        : [],
    );
    return c.json({
      keys,
      ruleKeys: await describeRuleApiKeys(deps.sql, organizationId, ruleKeyIds),
    });
  });

  /** Org usage metrics (the metrics page; admin) — the 0.4 fold reused. */
  app.get('/usage-metrics', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const periodRaw = Number(c.req.query('periodDays') ?? '7');
    const periodDays =
      periodRaw === 30
        ? (30 as const)
        : periodRaw === 90
          ? (90 as const)
          : (7 as const);
    const granRaw = c.req.query('granularity');
    const granularity =
      granRaw === 'weekly' || granRaw === 'monthly' ? granRaw : 'daily';
    return c.json(
      await getOrgUsageMetricsPg(deps.sql, c.get('orgId'), {
        periodDays,
        granularity,
        ...(c.req.query('agentSlug') !== undefined
          ? { agentSlug: c.req.query('agentSlug') ?? '' }
          : {}),
        ...(c.req.query('model') !== undefined
          ? { model: c.req.query('model') ?? '' }
          : {}),
        ...(c.req.query('provider') !== undefined
          ? { provider: c.req.query('provider') ?? '' }
          : {}),
      }),
    );
  });

  /**
   * The composer banner's read. `exceeded` is what the admission gate would
   * refuse RIGHT NOW — booked usage plus in-flight holds, over every bucket
   * that binds the member (their personal cap, each of their teams' shared
   * caps, the organization's) — and the warnings are read off the SAME
   * standing the gate measures (`readBudgetStanding`), so the banner and the
   * gate can never disagree. A team bucket's warning names the team.
   *
   * `projectId` is the project of the chat the member writes in: its cap
   * binds that chat's sends too, so it joins the standing there, by name. A
   * project the member cannot read reads as none.
   *
   * `selectedTeamId` is accepted and ignored: the account-menu team switcher
   * that used to narrow this view is gone — a member's standing is the
   * whole of what binds them, not one team's slice of it.
   */
  app.get('/my/budget-status', async (c) => {
    const organizationId = c.get('orgId');
    const userId = c.get('sessionBundle').user.id;
    const requestedProjectId = c.req.query('projectId');
    const projectId =
      requestedProjectId !== undefined &&
      requestedProjectId !== '' &&
      (await projectChatAccess(deps.sql, {
        projectId: requestedProjectId,
        organizationId,
        userId,
      })) === 'ok'
        ? requestedProjectId
        : undefined;
    const subject = await loadBudgetSubject(deps.sql, {
      organizationId,
      userId,
      ...(projectId !== undefined ? { projectIds: [projectId] } : {}),
    });
    const projectName = async (): Promise<string | null> => {
      if (projectId === undefined) return null;
      const rows = await deps.sql<{ name: string }[]>`
        SELECT name FROM app.projects
        WHERE id = ${projectId} AND org_id = ${organizationId}
      `;
      return rows[0]?.name ?? null;
    };
    const violation = await findBudgetViolation(deps.sql, subject, {
      reservations: await readInFlightReservations(deps.sql, subject),
    });
    if (violation !== null) {
      return c.json({
        status: {
          exceeded: true,
          code: violation.code,
          period: violation.period,
          used: violation.used,
          limit: violation.limit,
          reason: violation.reason,
          warnings: null,
          scope: violation.scope,
          ...(violation.scope === 'project'
            ? { projectId, projectName: await projectName() }
            : {}),
        },
      });
    }
    const warnings = collectStandingWarnings(
      await readBudgetStanding(deps.sql, subject),
    );
    if (warnings.length === 0) {
      return c.json({ status: null });
    }
    const teamIds = [
      ...new Set(
        warnings.flatMap((warning) =>
          warning.teamId === undefined ? [] : [warning.teamId],
        ),
      ),
    ];
    const teams =
      teamIds.length === 0
        ? []
        : await deps.sql<{ id: string; name: string }[]>`
            SELECT "id", "name" FROM "team" WHERE "id" = ANY(${teamIds})
          `;
    const teamName = new Map(teams.map((team) => [team.id, team.name]));
    const project = warnings.some((warning) => warning.projectId !== undefined)
      ? await projectName()
      : null;
    const named: (BudgetWarning & {
      teamName?: string | null;
      projectName?: string | null;
    })[] = [];
    for (const warning of warnings) {
      if (warning.teamId !== undefined) {
        named.push({
          ...warning,
          teamName: teamName.get(warning.teamId) ?? null,
        });
      } else if (warning.projectId !== undefined) {
        named.push({ ...warning, projectName: project });
      } else {
        named.push(warning);
      }
    }
    return c.json({
      status: {
        exceeded: false,
        code: null,
        period: null,
        used: null,
        limit: null,
        reason: null,
        warnings: named,
      },
    });
  });

  /**
   * The caller's standing at the model endpoints for API keys: whether the
   * organization turned them on (`modelApi.enabled` on its model-access
   * policy) and whether this member may call them (owner, admin or
   * developer by role, anyone else through a live `tale:models.api` grant).
   * The verdict only — the policy itself stays admin-read — and, once both
   * hold, the models the member may call there (the ids the endpoints take,
   * the same listing `GET /api/v1/openai/models` answers). The API settings
   * read it to show the Models tab's state and snippets, and to open the
   * REST and Models tabs to a member who holds the grant.
   */
  app.get('/my/model-api', async (c) => {
    const organizationId = c.get('orgId');
    const userId = c.get('sessionBundle').user.id;
    const standing = await readModelApiStanding(deps.sql, {
      organizationId,
      userId,
      role: c.get('orgMember').role,
    });
    const orgSlug =
      standing.enabled && standing.allowed
        ? await resolveOrgSlug(deps.sql, organizationId)
        : null;
    const models =
      orgSlug === null
        ? []
        : (
            await listModelApiModels(deps.sql, {
              organizationId,
              orgSlug,
              userId,
            })
          ).map((model) => ({ id: model.id, label: model.label }));
    return c.json({ ...standing, models });
  });

  /**
   * Whether the caller may create a personal API key — the rule the create
   * endpoint's gate holds them to (`auth/api-key-create-gate.ts`): owner,
   * admin or developer of any organization, or a live grant of a competence
   * that is used with a key — and whether they hold one already. The API
   * settings open the REST tab to such a member: to create a key, or to see
   * and revoke the ones they hold after the right lapsed.
   */
  app.get('/my/api-keys', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    const [mayCreate, holdsKeys] = await Promise.all([
      mayCreateApiKeys(deps.sql, userId),
      holdsApiKeys(deps.sql, userId, c.get('orgId')),
    ]);
    return c.json({ mayCreate, holdsKeys });
  });

  /**
   * The caller's standing under every budget cap that binds them — their
   * personal caps, each of their teams' shared caps and the organization's —
   * with the usage the gate measures and when each period resets. Unlike
   * `/my/budget-status` it answers at any usage level. Resolved caps only:
   * the raw rules name other members and API keys, so the policy stays
   * admin-read.
   */
  app.get('/my/budget-usage', async (c) => {
    const organizationId = c.get('orgId');
    const userId = c.get('sessionBundle').user.id;
    const standing = await readBudgetStanding(deps.sql, {
      organizationId,
      userId,
      userTeamIds: await getUserTeamIds(deps.sql, organizationId, userId),
      userRole: c.get('orgMember').role,
    });
    const teamIds = [
      ...new Set(standing.flatMap((s) => (s.teamId ? [s.teamId] : []))),
    ];
    const teamNames = new Map(
      teamIds.length === 0
        ? []
        : (
            await deps.sql<{ id: string; name: string }[]>`
              SELECT "id", "name" FROM "team"
              WHERE "organizationId" = ${organizationId}
                AND "id" = ANY(${teamIds})
            `
          ).map((row) => [row.id, row.name]),
    );
    const meter = (limit: number | undefined, used: number) =>
      limit === undefined ? null : { used, limit };
    return c.json({
      limits: standing.map((s) => ({
        scope: s.scope,
        teamId: s.teamId ?? null,
        teamName: s.teamId ? (teamNames.get(s.teamId) ?? null) : null,
        period: s.period,
        periodKey: s.periodKey,
        resetsAt: s.resetsAt,
        warningThresholdPercent: s.warningThresholdPercent ?? null,
        tokens: meter(s.maxTokens, s.usage.totalTokens),
        costCents: meter(s.maxCostCents, s.usage.costEstimate),
        requests: meter(s.maxRequests, s.usage.requestCount),
      })),
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
    if (!body.success) return invalidBodyResponse(c, body.error);
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
      // A restored document can be its ref's holder again — the lowest-id
      // active document holding a shared ref, whose scope the corpus row
      // carries — and a restore edits no scope, so no other write re-stamps
      // the row before the nightly reconcile. Best-effort, after commit.
      if (body.data.resourceType === 'document') {
        await syncRagDocumentScope(deps.sql, c.get('orgId'), body.data.id);
      }
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof TrashError) {
        return c.json({ error: error.code }, error.status);
      }
      // A contact restore refused by the directory's uniqueness rule.
      if (error instanceof ContactError) {
        return c.json({ error: error.code }, error.status);
      }
      throw error;
    }
  });

  // --- DSAR governance (owner-only writes; lazy-applied 24h grace) --------
  app.get('/dsar/policy', async (c) => {
    const role = c.get('orgMember').role;
    if (!isAdmin(role)) return c.json({ error: 'FORBIDDEN' }, 403);
    return c.json(
      await getDsarPolicyForUi(deps.sql, {
        organizationId: c.get('orgId'),
        role,
      }),
    );
  });

  app.post('/dsar/policy', async (c) => {
    if (c.get('orgMember').role.toLowerCase() !== 'owner') {
      return c.json(
        { error: 'FORBIDDEN', message: 'Owner role required' },
        403,
      );
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = dsarGovernanceConfigSchema.safeParse(
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
    const session = c.get('sessionBundle');
    try {
      return c.json(
        await proposeDsarPolicy(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            email: session.user.email,
          },
          parsed.data,
        ),
      );
    } catch (error) {
      return handleTailError(c, error);
    }
  });

  app.post('/dsar/policy/cancel-pending', async (c) => {
    if (c.get('orgMember').role.toLowerCase() !== 'owner') {
      return c.json(
        { error: 'FORBIDDEN', message: 'Owner role required' },
        403,
      );
    }
    const session = c.get('sessionBundle');
    try {
      await cancelPendingDsarPolicyChange(deps.sql, {
        organizationId: c.get('orgId'),
        userId: session.user.id,
        email: session.user.email,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleTailError(c, error);
    }
  });

  // --- Moderation provider (Security page) --------------------------------
  app.post('/moderation/secret', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = z
      .object({ authHeader: z.string().min(1).max(4096) })
      .safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    await saveGovernanceSecret(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
      },
      { name: MODERATION_SECRET_NAME, value: body.data.authHeader },
    );
    return c.json({ ok: true });
  });

  app.get('/moderation/secret/status', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    return c.json({
      masked: await readGovernanceSecretMasked(
        deps.sql,
        c.get('orgId'),
        MODERATION_SECRET_NAME,
      ),
    });
  });

  /** The admin's round trip through the REAL provider path — the same
   * call a chat turn makes, so a bad URL, key, template, or JSONPath shows
   * up here with the error class the events page would report. */
  app.post('/moderation/test', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = z
      .object({
        text: z.string().min(1).max(4096),
        direction: z.enum(['input', 'output']).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalidBodyResponse(c, body.error);
    return c.json(
      await testModerationProvider(deps.sql, c.get('orgId'), body.data),
    );
  });

  /** Guardrail aggregates for the chat-health page (the 0.4
   * `getGuardrailStats`: one bounded newest-first fold). */
  app.get('/chat-filter-events/stats', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const periodRaw = Number(c.req.query('periodDays') ?? '7');
    const periodDays = periodRaw === 1 ? 1 : periodRaw === 30 ? 30 : 7;
    return c.json(
      await getGuardrailStats(deps.sql, c.get('orgId'), { periodDays }),
    );
  });

  // --- Chat-filter events (Security page listing) -------------------------
  app.get('/chat-filter-events', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const limitParam = Number(c.req.query('limit') ?? '50');
    return c.json({
      events: await listRecentChatFilterEvents(deps.sql, c.get('orgId'), {
        ...(Number.isFinite(limitParam) ? { limit: limitParam } : {}),
        ...(c.req.query('filterName') !== undefined
          ? { filterName: c.req.query('filterName') }
          : {}),
        ...(c.req.query('kind') !== undefined
          ? { kind: c.req.query('kind') }
          : {}),
      }),
    });
  });

  return app;
}

function handleTailError(c: Context<OrgEnv>, error: unknown): Response {
  if (error instanceof GovernanceTailError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}
