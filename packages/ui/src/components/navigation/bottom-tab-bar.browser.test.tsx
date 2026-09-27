import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import {
  Brain,
  Folder,
  House,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Workflow,
} from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { BottomTabBar, BottomTabBarPlaceholder } from './bottom-tab-bar';

import '@tale/ui/globals.css';
import '../../fonts';

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

/**
 * The platform's four sections in German, the longest names the bar carries.
 * Truncated, "Automatisierungen" read "Automatisierun…" on a 390px phone and
 * lost four letters on a 360px one. Measured in the real Inter.
 */
describe('BottomTabBar labels in Chromium', () => {
  it.each([360, 390])(
    'reads every German section name whole at %ipx',
    async (width) => {
      await document.fonts.load('500 10px Inter');
      render(
        <div style={{ width }}>
          <BottomTabBar
            ariaLabel="Primary"
            items={[
              {
                key: 'home',
                label: 'Start',
                icon: House,
                active: true,
                onSelect,
              },
              { key: 'knowledge', label: 'Wissen', icon: Brain, onSelect },
              {
                key: 'automations',
                label: 'Automatisierungen',
                icon: Workflow,
                onSelect,
              },
              {
                key: 'settings',
                label: 'Einstellungen',
                icon: Settings,
                onSelect,
              },
            ]}
          />
        </div>,
      );
      for (const name of [
        'Start',
        'Wissen',
        'Automatisierungen',
        'Einstellungen',
      ]) {
        const label = screen.getByText(name);
        expect(label.scrollWidth, name).toBeLessThanOrEqual(label.clientWidth);
      }
    },
  );
});
