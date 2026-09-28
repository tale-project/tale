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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { useScrollCompact } from '../../hooks/use-scroll-compact';
import { ContentArea } from '../layout/content-area';
import { MobileFloatingActions } from '../layout/mobile-floating-actions';
import { BottomTabBar, BottomTabBarPlaceholder } from './bottom-tab-bar';

import '@tale/ui/globals.css';
import '../../fonts';

beforeEach(async () => {
  await page.viewport(390, 844);
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('boot-safari-toolbar', 'dark');
  document.documentElement.removeAttribute('data-mobile-keyboard');
});

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
  it('paints a translucent surface for the real card in both themes', () => {
    render(<BottomTabBar items={ITEMS} ariaLabel="Primary" />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas context');
    for (const dark of [false, true]) {
      document.documentElement.classList.toggle('dark', dark);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(nav).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const alpha = context.getImageData(0, 0, 1, 1).data[3];
      expect(alpha).toBeGreaterThan(128);
      expect(alpha).toBeLessThan(200);
      expect(getComputedStyle(nav).backdropFilter).toContain('blur(');
    }
  });

  it.each([320, 390])('is exactly as tall as the live bar at %ipx', (width) => {
    const { rerender } = render(
      <div
        data-testid="fixture"
        style={{ width, height: 600, position: 'relative' }}
      >
        <BottomTabBar items={ITEMS} ariaLabel="Primary" />
      </div>,
    );
    const live = screen
      .getByRole('navigation', { name: 'Primary' })
      .getBoundingClientRect();

    rerender(
      <div
        data-testid="fixture"
        style={{ width, height: 600, position: 'relative' }}
      >
        <BottomTabBarPlaceholder tabs={ITEMS.length} />
      </div>,
    );
    const placeholder = screen
      .getByTestId('fixture')
      .firstElementChild?.getBoundingClientRect();

    expect(live.height).toBe(60);
    expect(placeholder?.height).toBe(live.height);
    expect(placeholder?.width).toBe(live.width);
  });

  it('keeps the height when a label would overflow its tab', () => {
    const { rerender } = render(
      <div
        data-testid="fixture"
        style={{ width: 320, height: 600, position: 'relative' }}
      >
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
      <div
        data-testid="fixture"
        style={{ width: 320, height: 600, position: 'relative' }}
      >
        <BottomTabBarPlaceholder tabs={ITEMS.length} />
      </div>,
    );

    expect(
      screen.getByTestId('fixture').firstElementChild?.getBoundingClientRect()
        .height,
    ).toBe(live.height);
  });
});

/** Labels keep their full names inside the capsule, including at 320px. */
describe.each([
  ['en', ['Home', 'Knowledge', 'Automations', 'Settings']],
  ['de', ['Start', 'Wissen', 'Automatisierungen', 'Einstellungen']],
  ['fr', ['Accueil', 'Connaissances', 'Automatisations', 'Paramètres']],
] as const)('BottomTabBar %s labels in Chromium', (_locale, labels) => {
  it.each([320, 360, 390, 430])(
    'reads every section name whole at %ipx',
    async (width) => {
      await page.viewport(width, 844);
      await document.fonts.load('500 11px Inter');
      const icons = [House, Brain, Workflow, Settings];
      render(
        <div style={{ width, height: 600, position: 'relative' }}>
          <BottomTabBar
            ariaLabel="Primary"
            items={labels.map((label, index) => ({
              key: label,
              label,
              icon: icons[index],
              active: index === 0,
              onSelect,
            }))}
          />
        </div>,
      );
      for (const name of labels) {
        const label = screen.getByText(name);
        expect(label.scrollWidth, name).toBeLessThanOrEqual(label.clientWidth);
        const target = screen
          .getByRole('button', { name })
          .getBoundingClientRect();
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
    },
  );
});

describe('floating navigation layout', () => {
  it('overlays scroll content, clears the last item once, and lifts page actions', async () => {
    render(
      <div className="mobile-nav-shell" style={{ height: 600 }}>
        <div data-testid="scroll" style={{ height: '100%', overflow: 'auto' }}>
          <ContentArea data-testid="outer">
            <ContentArea data-testid="inner">
              <div style={{ height: 900 }}>Scrollable content</div>
              <button type="button">Last action</button>
            </ContentArea>
          </ContentArea>
        </div>
        <BottomTabBar items={ITEMS} ariaLabel="Primary" />
        <MobileFloatingActions>
          <button type="button">Save</button>
        </MobileFloatingActions>
      </div>,
    );
    const nav = screen.getByRole('navigation');
    const box = nav.getBoundingClientRect();
    expect(box.height).toBe(60);
    expect(box.left).toBeGreaterThan(0);
    expect(getComputedStyle(nav).position).toBe('absolute');
    expect(
      Number.parseFloat(getComputedStyle(nav).borderRadius),
    ).toBeGreaterThan(32);
    const scroll = screen.getByTestId('scroll');
    expect(scroll.getBoundingClientRect().height).toBe(600);
    scroll.scrollTop = scroll.scrollHeight;
    expect(
      screen
        .getByRole('button', { name: 'Last action' })
        .getBoundingClientRect().bottom,
    ).toBeLessThan(box.top);
    expect(
      Number.parseFloat(
        getComputedStyle(screen.getByTestId('inner')).paddingBottom,
      ),
    ).toBe(16 + 80);
    // The portal uses viewport coordinates; its lower edge clears the same
    // dock geometry at the viewport foot, including Safari's extra offset.
    await expect
      .poll(
        () =>
          getComputedStyle(
            screen
              .getByRole('button', { name: 'Save' })
              .closest('.fixed') as HTMLElement,
          ).bottom,
      )
      .toBe('76px');
    document.documentElement.classList.add('boot-safari-toolbar');
    expect(nav.getBoundingClientRect().height).toBe(60);
    await expect
      .poll(() => nav.getBoundingClientRect().bottom)
      .toBe(box.bottom - 48);
  });

  it('hides the dock and releases clearance for typing, and hides on desktop', async () => {
    render(
      <div className="mobile-nav-shell" style={{ height: 600 }}>
        <BottomTabBar items={ITEMS} ariaLabel="Primary" />
      </div>,
    );
    const nav = screen.getByRole('navigation');
    document.documentElement.setAttribute('data-mobile-keyboard', '');
    expect(getComputedStyle(nav).display).toBe('none');
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--mobile-nav-clearance')
        .trim(),
    ).toBe('0px');
    document.documentElement.removeAttribute('data-mobile-keyboard');
    expect(getComputedStyle(nav).display).not.toBe('none');
    await page.viewport(1024, 768);
    expect(getComputedStyle(nav).display).toBe('none');
  });
});

it('compacts without shrinking touch targets, losing names, or changing content clearance', async () => {
  const { rerender } = render(
    <div className="mobile-nav-shell" style={{ height: 600 }}>
      <BottomTabBar items={ITEMS} ariaLabel="Primary" />
    </div>,
  );
  const nav = screen.getByRole('navigation');
  const expanded = nav.getBoundingClientRect();
  const clearance = getComputedStyle(document.documentElement).getPropertyValue(
    '--mobile-nav-clearance',
  );
  rerender(
    <div className="mobile-nav-shell" style={{ height: 600 }}>
      <BottomTabBar compact items={ITEMS} ariaLabel="Primary" />
    </div>,
  );
  await expect.poll(() => nav.getBoundingClientRect().height).toBe(52);
  await expect.poll(() => nav.getBoundingClientRect().width).toBe(280);
  expect(nav.getBoundingClientRect().bottom).toBe(expanded.bottom + 4);
  expect(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--mobile-nav-clearance',
    ),
  ).toBe(clearance);
  for (const item of ITEMS) {
    const target = screen
      .getByRole('button', { name: item.label })
      .getBoundingClientRect();
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
  }
});

function ScrollFixture({
  route = '/home',
  showPane = true,
}: {
  route?: string;
  showPane?: boolean;
}) {
  const { compact, expand } = useScrollCompact(route);
  return (
    <div className="mobile-nav-shell" style={{ height: 600 }}>
      {showPane && (
        <div data-testid="pane" style={{ height: 600, overflowY: 'auto' }}>
          <div style={{ height: 1500 }}>Page content</div>
        </div>
      )}
      <BottomTabBar
        items={ITEMS}
        ariaLabel="Primary"
        compact={compact}
        onFocusCapture={expand}
      />
    </div>
  );
}
it('follows actual nested scroll events and resets on route and keyboard focus', async () => {
  const { rerender } = render(<ScrollFixture />);
  const pane = screen.getByTestId('pane');
  const nav = screen.getByRole('navigation');
  pane.scrollTop = 200;
  await expect.poll(() => nav.dataset.compact).toBe('true');
  pane.scrollTop = 175;
  await expect.poll(() => nav.dataset.compact).toBeUndefined();
  pane.scrollTop = 300;
  await expect.poll(() => nav.dataset.compact).toBe('true');
  rerender(<ScrollFixture route="/settings" />);
  await expect.poll(() => nav.dataset.compact).toBeUndefined();
  pane.scrollTop = 400;
  await expect.poll(() => nav.dataset.compact).toBe('true');
  screen.getByRole('button', { name: 'Chat' }).focus();
  await expect.poll(() => nav.dataset.compact).toBeUndefined();
  pane.scrollTop = 500;
  expect(nav.dataset.compact).toBeUndefined();
});

it('resizes when a settings scroll pane mounts after the shell', async () => {
  const { rerender } = render(<ScrollFixture showPane={false} />);
  rerender(<ScrollFixture />);
  const pane = screen.getByTestId('pane');
  const nav = screen.getByRole('navigation');
  pane.scrollTop = 200;
  await expect.poll(() => nav.getBoundingClientRect().height).toBe(52);
  pane.scrollTop = 150;
  await expect.poll(() => nav.getBoundingClientRect().height).toBe(60);
});
