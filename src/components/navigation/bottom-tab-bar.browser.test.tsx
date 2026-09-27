import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Folder, MessageCircle, MoreHorizontal } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { BottomTabBar, BottomTabBarPlaceholder } from './bottom-tab-bar';

import '@tale/ui/globals.css';

afterEach(cleanup);

const onSelect = () => {};

function items(suffix = '') {
  return [
    {
      key: 'chat',
      label: `Chat${suffix}`,
      icon: MessageCircle,
      active: true,
      onSelect,
    },
    { key: 'projects', label: `Projects${suffix}`, icon: Folder, onSelect },
    { key: 'more', label: `More${suffix}`, icon: MoreHorizontal, onSelect },
  ];
}
const ITEMS = items();

/**
 * The placeholder stands in for the bar while a loading shell paints: any
 * height difference moves everything laid out above it when the live bar
 * arrives. Measured in real Chromium, at a phone width and a narrow one.
 */
describe('BottomTabBarPlaceholder geometry in Chromium', () => {
  it.each([320, 390])('is exactly as tall as the live bar at %ipx', (width) => {
    const { rerender } = render(
      <div data-testid="fixture" style={{ width }}>
        <BottomTabBar items={ITEMS} ariaLabel="Primary" />
      </div>,
    );
    const live = screen
      .getByRole('navigation', { name: 'Primary' })
      .getBoundingClientRect();

    rerender(
      <div data-testid="fixture" style={{ width }}>
        <BottomTabBarPlaceholder tabs={ITEMS.length} />
      </div>,
    );
    const placeholder = screen
      .getByTestId('fixture')
      .firstElementChild?.getBoundingClientRect();

    expect(placeholder?.height).toBe(live.height);
    expect(placeholder?.width).toBe(live.width);
  });

  it('keeps the height when a label would overflow its tab', () => {
    const { rerender } = render(
      <div data-testid="fixture" style={{ width: 320 }}>
        <BottomTabBar
          items={items(' with a label far too long for a tab')}
          ariaLabel="Primary"
        />
      </div>,
    );
    const live = screen
      .getByRole('navigation', { name: 'Primary' })
      .getBoundingClientRect();

    rerender(
      <div data-testid="fixture" style={{ width: 320 }}>
        <BottomTabBarPlaceholder tabs={ITEMS.length} />
      </div>,
    );

    expect(
      screen.getByTestId('fixture').firstElementChild?.getBoundingClientRect()
        .height,
    ).toBe(live.height);
  });
});
