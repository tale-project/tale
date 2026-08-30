import { useMemo } from 'react';

import type { ProjectListItem } from './queries';
import { useProject } from './queries';

export interface EffectiveProjectConfig {
  /** Recommended agent slugs in display order (`recommended` mode). */
  recommendedAgentSlugs: string[];
  /** Allowlist of agent slugs (`restricted` mode). */
  allowedAgentSlugs: string[] | null;
  /** Mode for agent restriction. */
  agentMode: 'all' | 'recommended' | 'restricted';
  recommendedModels: string[];
  allowedModels: string[] | null;
  modelMode: 'all' | 'recommended' | 'restricted';
  /** True if applying the restriction to a user's RBAC set yields zero items. */
  isEmptyAgents: (rbacSlugs: string[]) => boolean;
  isEmptyModels: (rbacModels: string[]) => boolean;
  /** Reorder a list of slugs so recommended ones come first (in defined order). */
  prioritizeAgents: <T extends { slug: string }>(items: T[]) => T[];
  prioritizeModels: <T extends { id: string }>(items: T[]) => T[];
  /** Filter a list of items to the project's effective set. */
  filterAgents: <T extends { slug: string }>(items: T[]) => T[];
  filterModels: <T extends { id: string }>(items: T[]) => T[];
}

function intersect(rbac: string[], allowed: string[] | null): string[] {
  if (!allowed) return rbac;
  const set = new Set(allowed);
  return rbac.filter((s) => set.has(s));
}

export function deriveEffectiveProjectConfig(
  project: ProjectListItem | null,
): EffectiveProjectConfig {
  // Legacy `'all'` rows (or missing mode) are equivalent to `'recommended'`
  // with an empty list — same effective access, but the UI no longer offers
  // an `'all'` choice.
  const storedAgentMode = project?.agentMode;
  const storedModelMode = project?.modelMode;
  const agentMode: 'all' | 'recommended' | 'restricted' =
    storedAgentMode === 'restricted'
      ? 'restricted'
      : storedAgentMode === 'recommended'
        ? 'recommended'
        : 'recommended';
  const modelMode: 'all' | 'recommended' | 'restricted' =
    storedModelMode === 'restricted'
      ? 'restricted'
      : storedModelMode === 'recommended'
        ? 'recommended'
        : 'recommended';
  // In `restricted` mode the canonical list lives in `allowedAgentSlugs`
  // (UI mirrors it into `recommendedAgentSlugs` for the order); fall back
  // to the recommended slot so the order is still honoured for prioritization.
  const recommendedAgentSlugs =
    agentMode === 'restricted'
      ? (project?.recommendedAgentSlugs ?? project?.allowedAgentSlugs ?? [])
      : (project?.recommendedAgentSlugs ?? []);
  const allowedAgentSlugs =
    agentMode === 'restricted' ? (project?.allowedAgentSlugs ?? []) : null;
  const recommendedModels =
    modelMode === 'restricted'
      ? (project?.recommendedModels ?? project?.allowedModels ?? [])
      : (project?.recommendedModels ?? []);
  const allowedModels =
    modelMode === 'restricted' ? (project?.allowedModels ?? []) : null;

  function prioritizeAgents<T extends { slug: string }>(items: T[]): T[] {
    if (recommendedAgentSlugs.length === 0) {
      return items;
    }
    const priority = new Map<string, number>();
    recommendedAgentSlugs.forEach((s, i) => priority.set(s, i));
    return [...items].sort((a, b) => {
      const ai = priority.get(a.slug);
      const bi = priority.get(b.slug);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
  }

  function prioritizeModels<T extends { id: string }>(items: T[]): T[] {
    if (recommendedModels.length === 0) return items;
    const priority = new Map<string, number>();
    recommendedModels.forEach((s, i) => priority.set(s, i));
    return [...items].sort((a, b) => {
      const ai = priority.get(a.id);
      const bi = priority.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
  }

  function filterAgents<T extends { slug: string }>(items: T[]): T[] {
    if (agentMode !== 'restricted') return items;
    const allowed = new Set(allowedAgentSlugs ?? []);
    return items.filter((a) => allowed.has(a.slug));
  }

  function filterModels<T extends { id: string }>(items: T[]): T[] {
    if (modelMode !== 'restricted') return items;
    const allowed = new Set(allowedModels ?? []);
    return items.filter((m) => allowed.has(m.id));
  }

  return {
    agentMode,
    modelMode,
    recommendedAgentSlugs,
    allowedAgentSlugs,
    recommendedModels,
    allowedModels,
    isEmptyAgents: (rbacSlugs: string[]) =>
      agentMode === 'restricted'
        ? intersect(rbacSlugs, allowedAgentSlugs).length === 0
        : false,
    isEmptyModels: (rbacModels: string[]) =>
      modelMode === 'restricted'
        ? intersect(rbacModels, allowedModels).length === 0
        : false,
    prioritizeAgents,
    prioritizeModels,
    filterAgents,
    filterModels,
  };
}

export function useEffectiveProjectConfig(projectId: string | undefined) {
  const { project, isLoading } = useProject(projectId);
  const config = useMemo(
    () => deriveEffectiveProjectConfig(project),
    [project],
  );
  return { config, project, isLoading };
}
