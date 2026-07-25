import { describe, expect, it } from 'vitest';

import { resetCrossOrgDetailSubpath } from './org-switch-subpath';

describe('resetCrossOrgDetailSubpath', () => {
  it('resets an org-scoped entity-detail subpath to its section root', () => {
    expect(resetCrossOrgDetailSubpath('projects/abc123')).toBe('projects');
    expect(resetCrossOrgDetailSubpath('projects/abc123/tasks/board')).toBe(
      'projects',
    );
    expect(resetCrossOrgDetailSubpath('chat/t_1#mid')).toBe('chat');
  });

  it('preserves section roots, filters, and config subpaths', () => {
    expect(resetCrossOrgDetailSubpath('projects')).toBe('projects');
    expect(resetCrossOrgDetailSubpath('projects?archived=true')).toBe(
      'projects?archived=true',
    );
    expect(
      resetCrossOrgDetailSubpath('settings/governance?group=security'),
    ).toBe('settings/governance?group=security');
    // agents/{slug} and automations/{slug} are slug-keyed and exist per-org,
    // not Convex ids.
    expect(resetCrossOrgDetailSubpath('agents/my-agent')).toBe(
      'agents/my-agent',
    );
    expect(
      resetCrossOrgDetailSubpath('automations/github__triage-issues'),
    ).toBe('automations/github__triage-issues');
  });
});
