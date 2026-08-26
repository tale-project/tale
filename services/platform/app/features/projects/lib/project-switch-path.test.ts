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
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/overview`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/overview`);
  });

  it('resets bound views and nested automation details to Tasks', () => {
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/views/doc__verify/inbox`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/tasks`);
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}/automations/doc__verify`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/tasks`);
  });

  it('lands on Tasks when switching from the bare project URL', () => {
    expect(
      projectSwitchPathname(
        `/dashboard/${org}/projects/${from}`,
        org,
        from,
        to,
      ),
    ).toBe(`/dashboard/${org}/projects/${to}/tasks`);
  });
});
