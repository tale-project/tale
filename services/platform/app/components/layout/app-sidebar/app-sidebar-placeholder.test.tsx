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
    // 1 logo + 6 nav + 2 footer (bell + account). The nav count mirrors the
    // `primary` list in `use-navigation-items.ts` for the full-permission
    // case — when a nav item is added or retired there, this placeholder (and
    // this pin) must move with it, or the boot shell visibly over/under-draws.
    expect(container.querySelectorAll('.size-9')).toHaveLength(9);
  });
});
