/**
 * Pure spawn-time capability resolution for agent-on-demand jobs.
 *
 * Three-layer tool authorization (design: agent-on-demand §3.1) — grants are
 * allowlists, exceptions are a tiny structural denylist:
 *
 *   effective = WORKER_BASELINE ∪ (requested ∩ parent.allowed − PRIMARY_ONLY)
 *
 * Boundary violations are silently NARROWED, never errors: the parent
 * shouldn't need to know the org's config to spawn. The narrowing report is
 * embedded in the returned spec (shown on the job card) and in the spawn
 * result (so the parent can adapt).
 */

import type { SkillRuntimeEntry } from '../../lib/agent_chat/skills_runtime';
import type { ToolAvailability } from '../types';

/** Worker plumbing every job gets — not part of the request surface. */
export const WORKER_BASELINE_TOOLS = ['update_progress'] as const;

export interface ResolveJobSpecInput {
  requested: {
    tools: string[];
    skills?: string[];
    integrations?: string[];
    methodology?: string;
  };
  parent: {
    toolNames: string[];
    skillBindings: string[];
    integrationBindings: string[];
  };
  /** Registry availability per tool name (from getToolRegistryMap). */
  availability: ReadonlyMap<string, ToolAvailability>;
  /** The parent's turn-scoped skill snapshot entries, keyed by slug. */
  skillsBySlug: ReadonlyMap<string, SkillRuntimeEntry>;
}

export interface ResolvedJobCapabilities {
  effectiveTools: string[];
  skills: string[];
  integrations: string[];
  methodology?: { slug: string; body: string; versionHash: string };
  narrowed: {
    tools: string[];
    skills: string[];
    integrations: string[];
    methodology?: string;
  };
}

export function resolveJobSpec(
  input: ResolveJobSpecInput,
): ResolvedJobCapabilities {
  const parentTools = new Set(input.parent.toolNames);
  const parentSkills = new Set(input.parent.skillBindings);
  const parentIntegrations = new Set(input.parent.integrationBindings);

  const narrowedTools: string[] = [];
  const grantedTools: string[] = [];
  for (const tool of dedupe(input.requested.tools)) {
    const availability = input.availability.get(tool);
    const isGrantable =
      parentTools.has(tool) &&
      availability !== undefined &&
      availability !== 'primary-only';
    if (isGrantable) grantedTools.push(tool);
    else narrowedTools.push(tool);
  }

  const narrowedSkills: string[] = [];
  const skills: string[] = [];
  for (const slug of dedupe(input.requested.skills ?? [])) {
    if (parentSkills.has(slug) && input.skillsBySlug.has(slug)) {
      skills.push(slug);
    } else {
      narrowedSkills.push(slug);
    }
  }

  const narrowedIntegrations: string[] = [];
  const integrations: string[] = [];
  for (const name of dedupe(input.requested.integrations ?? [])) {
    if (parentIntegrations.has(name)) integrations.push(name);
    else narrowedIntegrations.push(name);
  }

  let methodology: ResolvedJobCapabilities['methodology'];
  let narrowedMethodology: string | undefined;
  if (input.requested.methodology) {
    const entry = parentSkills.has(input.requested.methodology)
      ? input.skillsBySlug.get(input.requested.methodology)
      : undefined;
    if (entry) {
      methodology = {
        slug: entry.slug,
        body: entry.body,
        versionHash: entry.versionHashLive,
      };
    } else {
      narrowedMethodology = input.requested.methodology;
    }
  }

  return {
    effectiveTools: [...WORKER_BASELINE_TOOLS, ...grantedTools],
    skills,
    integrations,
    methodology,
    narrowed: {
      tools: narrowedTools,
      skills: narrowedSkills,
      integrations: narrowedIntegrations,
      methodology: narrowedMethodology,
    },
  };
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/** Human-readable one-liner of everything narrowed away (empty = nothing). */
export function describeNarrowing(
  narrowed: ResolvedJobCapabilities['narrowed'],
): string {
  const parts: string[] = [];
  if (narrowed.tools.length > 0)
    parts.push(`tools: ${narrowed.tools.join(', ')}`);
  if (narrowed.skills.length > 0)
    parts.push(`skills: ${narrowed.skills.join(', ')}`);
  if (narrowed.integrations.length > 0)
    parts.push(`integrations: ${narrowed.integrations.join(', ')}`);
  if (narrowed.methodology) parts.push(`methodology: ${narrowed.methodology}`);
  return parts.join('; ');
}
