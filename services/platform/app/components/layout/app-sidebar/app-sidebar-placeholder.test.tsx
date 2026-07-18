import { beforeEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { AppSidebarPlaceholder } from './app-sidebar-placeholder';

describe('AppSidebarPlaceholder', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the expanded-width skeleton by default', () => {
    const { container } = render(
      <AppSidebarPlaceholder organizationId="org-1" />,
    );
    expect(
      container.querySelector('.lg\\:w-\\(--sidebar-width\\)'),
    ).not.toBeNull();
  });

  it('renders the rail-width skeleton when the org has a collapsed hint', () => {
    // Any user's key under this org counts — the userId isn't knowable
    // before auth resolves.
    window.localStorage.setItem('app-sidebar-expanded-user-9-org-1', 'false');
    const { container } = render(
      <AppSidebarPlaceholder organizationId="org-1" />,
    );
    expect(container.querySelector('.lg\\:w-\\(--sidebar-width\\)')).toBeNull();
    expect(
      container.querySelector('.w-\\(--sidebar-width-collapsed\\)'),
    ).not.toBeNull();
  });

  it('ignores hints from other orgs and expanded prefs', () => {
    window.localStorage.setItem('app-sidebar-expanded-user-9-org-2', 'false');
    window.localStorage.setItem('app-sidebar-expanded-user-9-org-1', 'true');
    const { container } = render(
      <AppSidebarPlaceholder organizationId="org-1" />,
    );
    expect(
      container.querySelector('.lg\\:w-\\(--sidebar-width\\)'),
    ).not.toBeNull();
  });
});
