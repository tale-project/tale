import { cleanup, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { DocsHeader } from './docs-header';

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
}));

afterEach(() => {
  cleanup();
});

const CRUMBS = [
  { label: 'Home', href: '/' },
  { label: 'Run Tale on your infrastructure', href: '/self-hosted' },
  { label: 'Choose an installation method', href: '/self-hosted/install' },
  { label: 'Run your first self-hosted instance' },
];

function renderStrip(width: number) {
  render(
    <div style={{ width }}>
      <DocsHeader
        crumbs={CRUMBS}
        actions={<button type="button">Copy page</button>}
      />
    </div>,
  );
  return screen.getByRole('navigation');
}

function visibleCrumbs(trail: HTMLElement): HTMLElement[] {
  return Array.from(trail.querySelectorAll<HTMLElement>('li')).filter(
    (li) => getComputedStyle(li).display !== 'none',
  );
}

// Beside the docs rail and the page actions, a 768px window leaves the trail
// ~200px. A deep page's trail used to keep every ancestor at full width and
// run 3px past the strip, collapsing the page's own name to nothing.
describe('DocsHeader trail (real layout)', () => {
  it('keeps the immediate parent and the leaf inside a narrow strip below lg', async () => {
    await page.viewport(900, 800);
    const trail = renderStrip(360);
    const crumbs = visibleCrumbs(trail);
    expect(crumbs.map((li) => li.textContent?.replace('/', '').trim())).toEqual(
      ['Choose an installation method', 'Run your first self-hosted instance'],
    );
    expect(trail.scrollWidth).toBeLessThanOrEqual(trail.clientWidth);
    for (const li of crumbs) {
      // Both keep a readable share of the row.
      expect(li.getBoundingClientRect().width).toBeGreaterThan(60);
    }
  });

  it('shows the whole trail from lg, the root crumb uncut', async () => {
    await page.viewport(1280, 800);
    const trail = renderStrip(640);
    const crumbs = visibleCrumbs(trail);
    expect(crumbs).toHaveLength(4);
    expect(trail.scrollWidth).toBeLessThanOrEqual(trail.clientWidth);
    const root = screen.getByRole('link', { name: 'Home' });
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  });
});
