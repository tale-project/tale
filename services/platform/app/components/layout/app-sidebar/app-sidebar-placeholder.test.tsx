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
});
