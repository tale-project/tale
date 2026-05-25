import { describe, it, expect } from 'vitest';

import type { ProjectListItem } from './queries';
import { deriveEffectiveProjectConfig } from './use-effective-project-config';

function makeProject(
  overrides: Partial<ProjectListItem> = {},
): ProjectListItem {
  return {
    // Convex-injected base fields
    _id: 'p1' as ProjectListItem['_id'],
    _creationTime: 0,
    organizationId: 'org',
    name: 'Project',
    createdBy: 'user',
    createdAt: 0,
    updatedAt: 0,
    isOrgWide: true,
    canEdit: true,
    canAdminister: true,
    ...overrides,
  };
}

describe('deriveEffectiveProjectConfig', () => {
  it('defaults to "all" for a null project', () => {
    const cfg = deriveEffectiveProjectConfig(null);
    expect(cfg.agentMode).toBe('all');
    expect(cfg.modelMode).toBe('all');
    expect(cfg.recommendedAgentSlugs).toEqual([]);
    expect(cfg.allowedAgentSlugs).toBeNull();
  });

  it('returns recommended ordering in "recommended" mode', () => {
    const cfg = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'recommended',
        recommendedAgentSlugs: ['recruiter-agent', 'email-outreach-helper'],
      }),
    );
    const result = cfg.prioritizeAgents([
      { slug: 'other-agent' },
      { slug: 'email-outreach-helper' },
      { slug: 'recruiter-agent' },
    ]);
    expect(result.map((r) => r.slug)).toEqual([
      'recruiter-agent',
      'email-outreach-helper',
      'other-agent',
    ]);
  });

  it('preserves order of non-recommended items', () => {
    const cfg = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'recommended',
        recommendedAgentSlugs: ['a'],
      }),
    );
    const result = cfg.prioritizeAgents([
      { slug: 'b' },
      { slug: 'a' },
      { slug: 'c' },
    ]);
    expect(result.map((r) => r.slug)).toEqual(['a', 'b', 'c']);
  });

  it('filters to allowed list in "restricted" mode', () => {
    const cfg = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'restricted',
        allowedAgentSlugs: ['allowed-1', 'allowed-2'],
      }),
    );
    const result = cfg.filterAgents([
      { slug: 'allowed-1' },
      { slug: 'forbidden' },
      { slug: 'allowed-2' },
    ]);
    expect(result.map((r) => r.slug)).toEqual(['allowed-1', 'allowed-2']);
  });

  it('does not filter in "all" or "recommended" modes', () => {
    const cfgAll = deriveEffectiveProjectConfig(
      makeProject({ agentMode: 'all' }),
    );
    expect(cfgAll.filterAgents([{ slug: 'a' }, { slug: 'b' }]).length).toBe(2);

    const cfgRec = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'recommended',
        recommendedAgentSlugs: ['a'],
      }),
    );
    expect(cfgRec.filterAgents([{ slug: 'a' }, { slug: 'b' }]).length).toBe(2);
  });

  it('isEmptyAgents returns true when restricted intersection is empty', () => {
    const cfg = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'restricted',
        allowedAgentSlugs: ['rare-agent'],
      }),
    );
    expect(cfg.isEmptyAgents(['agent-x', 'agent-y'])).toBe(true);
    expect(cfg.isEmptyAgents(['rare-agent', 'agent-x'])).toBe(false);
  });

  it('isEmptyAgents returns false in non-restricted modes regardless of RBAC', () => {
    const cfgAll = deriveEffectiveProjectConfig(
      makeProject({ agentMode: 'all' }),
    );
    expect(cfgAll.isEmptyAgents([])).toBe(false);

    const cfgRec = deriveEffectiveProjectConfig(
      makeProject({
        agentMode: 'recommended',
        recommendedAgentSlugs: ['x'],
      }),
    );
    expect(cfgRec.isEmptyAgents([])).toBe(false);
  });

  it('prioritizeModels and filterModels mirror agent semantics', () => {
    const cfg = deriveEffectiveProjectConfig(
      makeProject({
        modelMode: 'restricted',
        allowedModels: ['anthropic:claude-opus-4-7'],
      }),
    );
    const result = cfg.filterModels([
      { id: 'anthropic:claude-opus-4-7' },
      { id: 'openai:gpt-4o' },
    ]);
    expect(result.map((m) => m.id)).toEqual(['anthropic:claude-opus-4-7']);
  });
});
