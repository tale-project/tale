import { MessageSquare, Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  BottomTabBar,
  BottomTabBarPlaceholder,
  type BottomTabBarItem,
} from './bottom-tab-bar';

describe('BottomTabBarPlaceholder', () => {
  it('draws the requested number of masked tabs, hidden from assistive tech', () => {
    const { container } = render(<BottomTabBarPlaceholder tabs={3} />);

    const placeholder = container.firstElementChild;
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(
      placeholder?.querySelectorAll('[data-skeleton-mask="circle"]'),
    ).toHaveLength(3);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders no visible text, only zero-width line sizing', () => {
    const { container } = render(<BottomTabBarPlaceholder tabs={3} />);

    const text = (container.firstElementChild?.textContent ?? '')
      .replaceAll('\u200B', '')
      .trim();
    // The only text allowed is Skeletonize's screen-reader status label.
    expect(text === '' || text === 'Loading content').toBe(true);
  });
});

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

  it('reads a badge out with the caller’s translated meaning', () => {
    const items = makeItems('chat');
    items[1].badge = 7;
    items[1].badgeLabel = '7 ungelesene Konversationen';
    render(<BottomTabBar items={items} ariaLabel="Primary" />);
    // The tab's accessible name carries the meaning; the chip is decorative.
    expect(
      screen.getByRole('button', {
        name: /7 ungelesene Konversationen/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/unread/)).toBeNull();
  });

  it('falls back to English only when no meaning is given', () => {
    const items = makeItems('chat');
    items[1].badge = 7;
    render(<BottomTabBar items={items} ariaLabel="Primary" />);
    expect(
      screen.getByRole('button', { name: /\(7 unread\)/ }),
    ).toBeInTheDocument();
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
