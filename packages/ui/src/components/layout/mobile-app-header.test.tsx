import { Menu, Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { IconButton } from '../primitives/icon-button';
import { MobileAppHeader } from './mobile-app-header';

describe('MobileAppHeader', () => {
  it('renders as a banner landmark', () => {
    render(<MobileAppHeader>Title</MobileAppHeader>);
    expect(screen.getByRole('banner')).toBeVisible();
  });

  it('shows the title from children', () => {
    render(<MobileAppHeader>Conversations</MobileAppHeader>);
    expect(screen.getByText('Conversations')).toBeVisible();
  });

  it('renders start and end slots', () => {
    render(
      <MobileAppHeader
        start={<IconButton aria-label="Open menu" icon={Menu} />}
        end={<IconButton aria-label="Search" icon={Search} />}
      >
        Page
      </MobileAppHeader>,
    );
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <MobileAppHeader
          start={<IconButton aria-label="Open menu" icon={Menu} />}
          end={<IconButton aria-label="Search" icon={Search} />}
        >
          Title
        </MobileAppHeader>,
      );
      await checkAccessibility(container);
    });
  });
});
