import { MessageSquare, Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { BottomTabBar, type BottomTabBarItem } from './bottom-tab-bar';

function makeItems(activeKey: string): BottomTabBarItem[] {
  return [
    {
      key: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      active: activeKey === 'chat',
      onSelect: vi.fn(),
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: Settings,
      active: activeKey === 'settings',
      onSelect: vi.fn(),
    },
  ];
}

describe('BottomTabBar', () => {
  it('renders as a nav landmark with the provided label', () => {
    render(<BottomTabBar items={makeItems('chat')} ariaLabel="Primary" />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });

  it('marks the active item with aria-current="page"', () => {
    render(<BottomTabBar items={makeItems('settings')} ariaLabel="Primary" />);
    const active = screen.getByRole('button', { name: /settings/i });
    expect(active).toHaveAttribute('aria-current', 'page');
    const inactive = screen.getByRole('button', { name: /chat/i });
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('fires onSelect when an item is clicked', async () => {
    const items = makeItems('chat');
    const { user } = render(<BottomTabBar items={items} ariaLabel="Primary" />);
    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders a badge when provided', () => {
    const items = makeItems('chat');
    items[1].badge = 7;
    render(<BottomTabBar items={items} ariaLabel="Primary" />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <BottomTabBar items={makeItems('chat')} ariaLabel="Primary" />,
      );
      await checkAccessibility(container);
    });
  });
});
