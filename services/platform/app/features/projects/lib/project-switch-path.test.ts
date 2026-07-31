import { describe, expect, it } from 'vitest';

import { projectSwitchPathname } from './project-switch-path';

describe('projectSwitchPathname', () => {
  const org = 'org-1';
  const from = 'proj-a';
  const to = 'proj-b';

  it('preserves portable tabs and task sub-views', () => {
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/files`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/files`);
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/tasks/board`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/tasks/board`);
  });

  it('resets bound views and nested automation details to the overview', () => {
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/views/levy__desk/inbox`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}`);
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/automations/levy__desk`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}`);
  });

  it('stays on the overview when already there', () => {
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}`);
  });
});
