/**
 * Pure helpers for the organigram's staged-edit model.
 *
 * The canvas edits a DRAFT of each agent's outgoing delegation edges
 * (`directReports`) keyed by slug, and only persists on Save. Incoming edges
 * ("reports to") are derived from the outgoing edges, so a "reports to" edit
 * is translated into adjustments of OTHER agents' outgoing lists. Keeping that
 * translation here (React-free) makes it unit-testable in isolation.
 */

import type { OrgChartNode } from '@/convex/agents/org_chart_actions';

/** Outgoing delegation edges keyed by agent slug — the editable draft. */
export type ReportsMap = Record<string, string[]>;

/** Dedupe + lexicographically sort a slug list (the canonical set form). */
export const dedupeSorted = (slugs: string[]): string[] =>
  [...new Set(slugs)].sort();

/**
 * Recompute each node's derived incoming edges (`parentSlugs` + the primary
 * `managerSlug`) from the authoritative outgoing edges (`directReports`) so
 * the draft graph stays internally consistent as either side is edited.
 */
export function recomputeDerived(nodes: OrgChartNode[]): OrgChartNode[] {
  const parentsBySlug = new Map<string, string[]>();
  for (const node of nodes) {
    for (const child of node.directReports) {
      if (child === node.slug) continue;
      const list = parentsBySlug.get(child) ?? [];
      if (!list.includes(node.slug)) list.push(node.slug);
      parentsBySlug.set(child, list);
    }
  }
  return nodes.map((node) => {
    const parents = (parentsBySlug.get(node.slug) ?? []).slice().sort();
    return { ...node, parentSlugs: parents, managerSlug: parents[0] };
  });
}

/** Seed a draft from the server nodes (outgoing edges, order-normalized). */
export function buildReportsMap(nodes: OrgChartNode[]): ReportsMap {
  const map: ReportsMap = {};
  for (const node of nodes) map[node.slug] = dedupeSorted(node.directReports);
  return map;
}

/** Apply the draft's outgoing edges over the server nodes. */
export function applyDraft(
  nodes: OrgChartNode[],
  draft: ReportsMap,
): OrgChartNode[] {
  return nodes.map((node) => ({
    ...node,
    directReports: dedupeSorted(draft[node.slug] ?? node.directReports),
  }));
}

/** Order-insensitive comparison of two reports maps (delegation is a set). */
export function reportsEqual(a: ReportsMap, b: ReportsMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    const av = dedupeSorted(a[key] ?? []);
    const bv = dedupeSorted(b[key] ?? []);
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}

/** Stage one agent's outgoing edges (its direct reports). */
export function setDelegatesInDraft(
  draft: ReportsMap,
  agentSlug: string,
  delegateSlugs: string[],
): ReportsMap {
  return { ...draft, [agentSlug]: dedupeSorted(delegateSlugs) };
}

/**
 * Stage one agent's incoming edges by adjusting every OTHER agent's outgoing
 * reports so exactly the chosen parents include this agent.
 */
export function setParentsInDraft(
  draft: ReportsMap,
  agentSlug: string,
  parentSlugs: string[],
): ReportsMap {
  const desired = new Set(parentSlugs);
  const next: ReportsMap = {};
  for (const [slug, reports] of Object.entries(draft)) {
    if (slug === agentSlug) {
      next[slug] = reports;
      continue;
    }
    const has = reports.includes(agentSlug);
    const should = desired.has(slug);
    if (has === should) {
      next[slug] = reports;
      continue;
    }
    next[slug] = should
      ? dedupeSorted([...reports, agentSlug])
      : reports.filter((s) => s !== agentSlug);
  }
  return next;
}

/** Slugs whose outgoing edge set differs between the draft and the baseline. */
export function changedReportSlugs(
  draft: ReportsMap,
  baseline: ReportsMap,
): string[] {
  return Object.keys(draft).filter(
    (slug) =>
      !reportsEqual(
        { [slug]: draft[slug] ?? [] },
        { [slug]: baseline[slug] ?? [] },
      ),
  );
}
