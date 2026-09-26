import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { AppSidebarPlaceholder } from './app-sidebar-placeholder';

describe('AppSidebarPlaceholder', () => {
  it('renders the rail-width skeleton with a masked status region', () => {
    const { container } = render(<AppSidebarPlaceholder />);
    expect(
      container.querySelector('.w-\\(--sidebar-width-collapsed\\)'),
    ).not.toBeNull();
    // Skeletonize announces one status region for the masked rail.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('draws one tile per primary nav item, plus logo and footer', () => {
    const { container } = render(<AppSidebarPlaceholder />);
    // 1 logo + 1 search + 3 sections (Home, Knowledge, Automations) + 3
    // footer (bell + Settings + account). The section count mirrors the
    // `primary` list in `use-navigation-items.ts` — when a section is added or
    // retired there, this placeholder (and this pin) must move with it, or
    // the boot shell visibly over/under-draws.
    expect(container.querySelectorAll('.size-9')).toHaveLength(8);
  });
});
