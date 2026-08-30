import { describe, expect, it } from 'vitest';

import { automationListTarget } from './list-target';

describe('automationListTarget', () => {
  it('sends an org-level row to the org automation route', () => {
    expect(
      automationListTarget({
        organizationId: 'org-1',
        name: 'org/digest',
        boundProjectIds: [],
      }),
    ).toEqual({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'org__digest' },
    });
  });

  it('keeps a project-tab row inside the project shell', () => {
    expect(
      automationListTarget({
        organizationId: 'org-1',
        name: 'desk/prepare-return',
        listProjectId: 'proj_1' as string,
        boundProjectIds: [],
      }),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('routes a single-bound org-page row into its project shell', () => {
    expect(
      automationListTarget({
        organizationId: 'org-1',
        name: 'desk/prepare-return',
        boundProjectIds: ['proj_1' as string],
      }),
    ).toEqual({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('keeps a multi-bound row on the org route', () => {
    expect(
      automationListTarget({
        organizationId: 'org-1',
        name: 'desk/prepare-return',
        boundProjectIds: ['proj_1' as string, 'proj_2' as string],
      }),
    ).toEqual({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'desk__prepare-return' },
    });
  });
});
