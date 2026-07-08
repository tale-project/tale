import { describe, expect, it } from 'vitest';

import { resetCrossOrgDetailSubpath } from './org-switch-subpath';

describe('resetCrossOrgDetailSubpath', () => {
  it('resets an org-scoped entity-detail subpath to its section root', () => {
    expect(resetCrossOrgDetailSubpath('projects/abc123')).toBe('projects');
    expect(resetCrossOrgDetailSubpath('projects/abc123/tasks/board')).toBe(
      'projects',
    );
    expect(resetCrossOrgDetailSubpath('chat/t_1#mid')).toBe('chat');
    // Workflows has no standalone list route — a detail resets to the org home.
    expect(resetCrossOrgDetailSubpath('workflows/my-workflow?panel=test')).toBe(
      '',
    );
  });

  it('preserves section roots, filters, and config subpaths', () => {
    expect(resetCrossOrgDetailSubpath('projects')).toBe('projects');
    expect(resetCrossOrgDetailSubpath('projects?archived=true')).toBe(
      'projects?archived=true',
    );
    expect(
      resetCrossOrgDetailSubpath('settings/governance?group=security'),
    ).toBe('settings/governance?group=security');
    // agents/{slug} is slug-keyed config that exists per-org, not a Convex id.
    expect(resetCrossOrgDetailSubpath('agents/my-agent')).toBe(
      'agents/my-agent',
    );
  });
});
