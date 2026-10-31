import { cleanup, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { TabNavigation } from './tab-navigation';

import '../../globals.css';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: { to: string; children: React.ReactNode; className?: string },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/automations/review/editor' }),
  useSearch: () => ({}),
}));

afterEach(() => {
  cleanup();
});

const TABS = [
  { label: 'Editor', href: '/automations/review/editor' },
  { label: 'Versions', href: '/automations/review/versions' },
  { label: 'Runs', href: '/automations/review/runs' },
];

// The automation editor's verbs: a cluster that wraps.
function Verbs() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {['v1', 'Deploy this version', 'Test run', 'Run live', 'Discard'].map(
        (label) => (
          <button
            key={label}
            type="button"
            className="h-8 px-3 text-sm whitespace-nowrap"
          >
            {label}
          </button>
        ),
      )}
      <button type="button" className="h-8 px-3 text-sm">
        Save
      </button>
    </div>
  );
}

// Which of the strip's claimants gives way is a flex-layout outcome — only a
// real engine answers it. At a 768px window the editor's column is ~715px:
// the verbs used to keep their one line and slide the Runs tab under them.
describe('TabNavigation trailing actions (real layout)', () => {
  it('keeps every tab in view and wraps the actions instead', async () => {
    await page.viewport(1280, 900);
    render(
      <div style={{ width: 715 }}>
        <TabNavigation items={TABS} ariaLabel="Automation">
          <Verbs />
        </TabNavigation>
      </div>,
    );
    const strip = screen.getByRole('navigation', { name: 'Automation' });
    const actions = screen.getByRole('button', { name: 'Save' });
    // The strip's child holding the actions: the pinned trailing group.
    const group = Array.from(strip.children).find((child) =>
      child.contains(actions),
    );
    if (!group) throw new Error('no trailing action group');
    for (const tab of TABS) {
      const link = screen.getByRole('link', { name: tab.label });
      // Fully visible: left of the action group, inside the strip.
      expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
        group.getBoundingClientRect().left,
      );
    }
    // The verbs took a second line rather than overflowing the strip.
    const first = screen.getByRole('button', { name: 'v1' });
    expect(actions.getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().top,
    );
    expect(actions.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().right,
    );
  });

  it('keeps tabs and actions on one line when the strip holds both', async () => {
    await page.viewport(1280, 900);
    render(
      <div style={{ width: 1100 }}>
        <TabNavigation items={TABS} ariaLabel="Automation">
          <Verbs />
        </TabNavigation>
      </div>,
    );
    const first = screen.getByRole('button', { name: 'v1' });
    const last = screen.getByRole('button', { name: 'Save' });
    expect(last.getBoundingClientRect().top).toBeCloseTo(
      first.getBoundingClientRect().top,
      0,
    );
    // The fixed strip height holds while nothing wraps.
    const strip = screen.getByRole('navigation', { name: 'Automation' });
    expect(strip.getBoundingClientRect().height).toBeCloseTo(52, 0);
  });
});
