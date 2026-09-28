/**
 * Whether the Automations section holds anything for someone who cannot
 * build automations. Every organization is seeded with undeployed packages,
 * so drafts alone must not count; a deployed automation bound to a project
 * shows on that project's tab instead.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { backendQuery } = vi.hoisted(() => ({ backendQuery: vi.fn() }));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (ref: unknown, args: unknown) => backendQuery(ref, args),
}));

import { useAutomationsAvailability } from './use-automations-availability';

/** One row as `listAutomations` returns it: `deployedVersion` appears only
 * once someone deploys, `projectIds` names the projects it is bound to. */
function row(
  name: string,
  projectIds: string[],
  deployedVersion?: number,
): Record<string, unknown> {
  return {
    name,
    latest: 1,
    projectIds,
    ...(deployedVersion !== undefined ? { deployedVersion } : {}),
  };
}

function availability(rows: unknown[] | undefined) {
  backendQuery.mockImplementation(() => ({ data: rows, isLoading: false }));
  return renderHook(() => useAutomationsAvailability('org-1')).result.current;
}

beforeEach(() => {
  backendQuery.mockReset();
});

describe('useAutomationsAvailability', () => {
  it('requests only organization-wide automations', () => {
    availability([]);
    expect(backendQuery).toHaveBeenCalledWith(
      'automations/queries:listAutomations',
      { organizationId: 'org-1' },
    );
  });

  it('counts nothing for seeded, undeployed packages', () => {
    expect(
      availability([row('mail-sync', []), row('digest', [])])
        .hasLiveOrgAutomation,
    ).toBe(false);
  });

  it('counts nothing for a deployed automation bound to a project', () => {
    expect(
      availability([row('invoice-desk', ['p-1'], 2)]).hasLiveOrgAutomation,
    ).toBe(false);
  });

  it('does not mistake hidden project bindings for organization scope', () => {
    // The app listing removes unreadable project IDs, so a project-only
    // automation can have [] in the all-projects response. The org-only
    // listing excludes it using its actual bindings before that projection.
    backendQuery.mockImplementation(
      (_ref: unknown, args: { includeProjectBound?: boolean }) => ({
        data: args.includeProjectBound
          ? [row('hidden-project-only', [], 1)]
          : [],
        isLoading: false,
      }),
    );
    const { result } = renderHook(() => useAutomationsAvailability('org-1'));

    expect(result.current.hasLiveOrgAutomation).toBe(false);
  });

  it('counts a deployed organization automation', () => {
    expect(
      availability([row('mail-sync', [], 1), row('digest', [])])
        .hasLiveOrgAutomation,
    ).toBe(true);
  });

  it('answers false while the listing has not arrived', () => {
    expect(availability(undefined).hasLiveOrgAutomation).toBe(false);
  });

  it('skips the listing without an organization', () => {
    availability([]);
    renderHook(() => useAutomationsAvailability(''));
    expect(backendQuery).toHaveBeenLastCalledWith(
      'automations/queries:listAutomations',
      'skip',
    );
  });
});
