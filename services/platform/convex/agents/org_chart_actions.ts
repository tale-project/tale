'use node';

/**
 * Public surface of the agents-only organigram — the many-to-many delegation
 * graph the UI renders and the SINGLE write path for delegation edges.
 *
 *  - `getOrgChart` (member-gated): every agent with its direct reports
 *    (outgoing delegation edges), parent slugs (incoming edges), a
 *    deterministic primary manager, and per-node guardrail snapshots (month
 *    spend vs budget, running count, paused badge). Dangling/self edges are
 *    dropped; cycles are allowed.
 *  - `setAgentDelegates` / `setAgentParents` (developer-capability-gated):
 *    edit one agent's outgoing / incoming edges — validated (no self-edge,
 *    real targets), written atomically to the JSON file(s), audited, and
 *    write-through cache-dropped so the next read sees it immediately.
 *
 * `saveAgent` (file_actions) deliberately strips incoming `delegates` /
 * `reportsTo` and re-applies the on-disk values, so the organigram remains
 * the only editor of delegation edges.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  buildChartFromRoster,
  readWorkforceRoster,
  writeAgentDelegates,
  writeAgentParents,
} from './workforce_ops';

export interface OrgChartNode {
  slug: string;
  displayName?: string;
  description?: string;
  /** Agents this agent delegates to (its direct reports / outgoing edges). */
  directReports: string[];
  /** Agents that delegate to this agent (its parents / incoming edges). */
  parentSlugs: string[];
  /** Deterministic primary parent — the manager runtime escalation acts on. */
  managerSlug?: string;
  budget?: { monthlyCents: number; spentCents: number; pct: number };
  budgetPaused: boolean;
  running: number;
  maxConcurrentTasks?: number;
  /** A delegate/manager edge on this agent was dropped (dangling/self). */
  hasWarning: boolean;
}

export interface OrgChartPayload {
  nodes: OrgChartNode[];
  warnings: Array<{ type: string; slug: string; manager?: string }>;
}

export const getOrgChart = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<OrgChartPayload> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const roster = await readWorkforceRoster(auth.orgSlug);
    const chart = buildChartFromRoster(roster);

    const snapshots = await ctx.runQuery(
      internal.agents.guardrails.budget_guard.getWorkforceSnapshots,
      {
        organizationId: args.organizationId,
        agentSlugs: roster.map((entry) => entry.slug),
      },
    );
    const snapshotBySlug = new Map(snapshots.map((s) => [s.slug, s]));
    const warned = new Set(chart.warnings.map((w) => w.slug));

    const nodes: OrgChartNode[] = roster.map((entry) => {
      const directReports = chart.reports.get(entry.slug) ?? [];
      const snapshot = snapshotBySlug.get(entry.slug);
      const spentCents = snapshot?.monthSpentCents ?? 0;
      return {
        slug: entry.slug,
        displayName: entry.displayName,
        description: entry.description,
        directReports,
        parentSlugs: chart.parentsAll.get(entry.slug) ?? [],
        managerSlug: chart.parents.get(entry.slug),
        budget: entry.budget
          ? {
              monthlyCents: entry.budget.monthlyCents,
              spentCents,
              pct:
                entry.budget.monthlyCents > 0
                  ? Math.min(
                      999,
                      Math.round(
                        (spentCents / entry.budget.monthlyCents) * 100,
                      ),
                    )
                  : 0,
            }
          : undefined,
        budgetPaused: snapshot?.budgetPaused ?? false,
        running: snapshot?.running ?? 0,
        maxConcurrentTasks: entry.maxConcurrentTasks,
        hasWarning: warned.has(entry.slug),
      };
    });

    return {
      nodes: nodes.sort((a, b) => a.slug.localeCompare(b.slug)),
      warnings: chart.warnings.map((w) => ({
        type: w.type,
        slug: w.slug,
        manager: w.type === 'dangling' ? w.manager : undefined,
      })),
    };
  },
});

/**
 * Set the agents `agentSlug` delegates to (its outgoing edges / direct
 * reports). Validation + the file writes live in `writeAgentDelegates`,
 * shared with the `organigram_write` agent tool's path.
 */
export const setAgentDelegates = action({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    delegateSlugs: v.array(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    const { previous } = await writeAgentDelegates({
      orgSlug: auth.orgSlug,
      agentSlug: args.agentSlug,
      delegateSlugs: args.delegateSlugs,
    });

    await ctx.runMutation(internal.agents.audit_mutations.logAgentAuditEvent, {
      organizationId: auth.orgId,
      actorId: auth.userId,
      ...(auth.email ? { actorEmail: auth.email } : {}),
      actorRole: auth.member.role,
      action: 'set_agent_delegates',
      resourceId: args.agentSlug,
      previousState: { delegates: previous },
      newState: { delegates: args.delegateSlugs },
    });
    return { ok: true };
  },
});

/**
 * Set the agents that delegate to `agentSlug` (its incoming edges / "reports
 * to" list) by adjusting each parent's `delegates`. Validation + the file
 * writes live in `writeAgentParents`.
 */
export const setAgentParents = action({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    parentSlugs: v.array(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    const { previous } = await writeAgentParents({
      orgSlug: auth.orgSlug,
      agentSlug: args.agentSlug,
      parentSlugs: args.parentSlugs,
    });

    await ctx.runMutation(internal.agents.audit_mutations.logAgentAuditEvent, {
      organizationId: auth.orgId,
      actorId: auth.userId,
      ...(auth.email ? { actorEmail: auth.email } : {}),
      actorRole: auth.member.role,
      action: 'set_agent_parents',
      resourceId: args.agentSlug,
      previousState: { reportsTo: previous },
      newState: { reportsTo: args.parentSlugs },
    });
    return { ok: true };
  },
});
