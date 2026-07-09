import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { SiteHeader } from './site-header';

describe('SiteHeader', () => {
  it('is transparent with a light bottom border at the top of the page', () => {
    const { container } = render(
      <SiteHeader
        openMenuLabel="Open menu"
        closeMenuLabel="Close menu"
        logo={<a href="/">Tale</a>}
        desktopNav={<span>Nav</span>}
        surface="site"
      />,
    );

    const header = container.querySelector('header');
    expect(header).toBeTruthy();
    expect(header?.className).toContain('bg-transparent');
    expect(header?.className).toMatch(/border-border-base\/40/);
    expect(header?.className).not.toMatch(/bg-surface-site/);
  });

  it('stays transparent at the top when surface is omitted', () => {
    const { container } = render(
      <SiteHeader
        openMenuLabel="Open menu"
        closeMenuLabel="Close menu"
        logo={<a href="/">Tale</a>}
      />,
    );

    const header = container.querySelector('header');
    expect(header?.className).toContain('bg-transparent');
    expect(header?.className).toMatch(/border-border-base\/40/);
    expect(header?.className).not.toMatch(/bg-bg-base/);
  });
});
