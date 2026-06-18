/**
 * Resolve a step's `role` annotation to a concrete agent slug against the
 * existing org-chart delegation graph. Synthesized, not a new entity — and
 * ADVISORY: a role that doesn't resolve never breaks execution, it just yields
 * a `reason` the caller (UI projection / optional assignment) can surface.
 *
 * A role is either a reserved STRUCTURAL token (manager/report/self, relative to
 * a context agent's position in the graph) or, in the open case, an agent slug.
 * Ambiguity (a structural token matching several agents) is surfaced via
 * `ambiguous` rather than guessed.
 *
 * The pure resolution (`resolveRoleAgainstRoster`) takes a roster so it is fully
 * unit-testable without filesystem/ctx; `resolveRoleToAgent` is the thin I/O
 * wrapper that reads the live roster first.
 */
import { isStructuralRole } from '../../lib/shared/platform/roles';
import {
  type WorkforceRosterEntry,
  buildChartFromRoster,
  readWorkforceRoster,
} from './workforce_ops';

export interface RoleResolution {
  /** The resolved agent slug, when resolution is unambiguous. */
  agentSlug?: string;
  /** Candidate slugs when a structural token matches more than one agent. */
  ambiguous?: string[];
  /** Why resolution did not produce a single agent (advisory). */
  reason?: string;
}

export function resolveRoleAgainstRoster(
  role: string,
  ctxAgentSlug: string | undefined,
  roster: WorkforceRosterEntry[],
): RoleResolution {
  const known = new Set(roster.map((entry) => entry.slug));

  // Open case: the role IS an agent slug.
  if (!isStructuralRole(role)) {
    return known.has(role)
      ? { agentSlug: role }
      : { reason: `role "${role}" is not a known agent slug` };
  }

  // Structural tokens are relative to a context agent.
  if (!ctxAgentSlug) {
    return { reason: `structural role "${role}" requires a context agent` };
  }

  if (role === 'self') {
    return known.has(ctxAgentSlug)
      ? { agentSlug: ctxAgentSlug }
      : { reason: `context agent "${ctxAgentSlug}" is not in the roster` };
  }

  const chart = buildChartFromRoster(roster);

  if (role === 'manager') {
    const managerSlug = chart.parents.get(ctxAgentSlug);
    return managerSlug
      ? { agentSlug: managerSlug }
      : { reason: `no manager for "${ctxAgentSlug}"` };
  }

  // role === 'report'
  const reports = chart.reports.get(ctxAgentSlug) ?? [];
  if (reports.length === 0) {
    return { reason: `no direct reports for "${ctxAgentSlug}"` };
  }
  if (reports.length === 1) {
    return { agentSlug: reports[0] };
  }
  return {
    ambiguous: reports,
    reason: `"${ctxAgentSlug}" has multiple direct reports`,
  };
}

export async function resolveRoleToAgent(
  orgSlug: string,
  role: string,
  ctxAgentSlug?: string,
): Promise<RoleResolution> {
  const roster = await readWorkforceRoster(orgSlug);
  return resolveRoleAgainstRoster(role, ctxAgentSlug, roster);
}
