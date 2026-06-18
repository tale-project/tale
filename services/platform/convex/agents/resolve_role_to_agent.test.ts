import { describe, expect, it } from 'vitest';

import { resolveRoleAgainstRoster } from './resolve_role_to_agent';
import type { WorkforceRosterEntry } from './workforce_ops';

const roster: WorkforceRosterEntry[] = [
  { slug: 'coordinator', delegates: ['implementer', 'reviewer'] },
  { slug: 'implementer', delegates: [] },
  { slug: 'reviewer', delegates: [] },
];

describe('resolveRoleAgainstRoster', () => {
  it('resolves an open agent-slug role directly', () => {
    expect(resolveRoleAgainstRoster('implementer', undefined, roster)).toEqual({
      agentSlug: 'implementer',
    });
  });

  it('reports a reason for an unknown agent slug', () => {
    const res = resolveRoleAgainstRoster('ghost', undefined, roster);
    expect(res.agentSlug).toBeUndefined();
    expect(res.reason).toContain('not a known agent slug');
  });

  it('resolves "self" to the context agent', () => {
    expect(resolveRoleAgainstRoster('self', 'implementer', roster)).toEqual({
      agentSlug: 'implementer',
    });
  });

  it('resolves "manager" via the delegation graph', () => {
    expect(resolveRoleAgainstRoster('manager', 'implementer', roster)).toEqual({
      agentSlug: 'coordinator',
    });
  });

  it('reports no manager for a root agent', () => {
    const res = resolveRoleAgainstRoster('manager', 'coordinator', roster);
    expect(res.agentSlug).toBeUndefined();
    expect(res.reason).toContain('no manager');
  });

  it('resolves "report" to the single direct report when unambiguous', () => {
    const small: WorkforceRosterEntry[] = [
      { slug: 'lead', delegates: ['only'] },
      { slug: 'only', delegates: [] },
    ];
    expect(resolveRoleAgainstRoster('report', 'lead', small)).toEqual({
      agentSlug: 'only',
    });
  });

  it('surfaces ambiguity (not a guess) when "report" matches many', () => {
    const res = resolveRoleAgainstRoster('report', 'coordinator', roster);
    expect(res.agentSlug).toBeUndefined();
    expect(res.ambiguous).toEqual(['implementer', 'reviewer']);
  });

  it('requires a context agent for structural tokens', () => {
    const res = resolveRoleAgainstRoster('manager', undefined, roster);
    expect(res.reason).toContain('requires a context agent');
  });
});
