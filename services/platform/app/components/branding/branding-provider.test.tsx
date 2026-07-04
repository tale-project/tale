// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { adjustColorForTheme } from '@/lib/utils/color';

import { BrandingProvider } from './branding-provider';

// The provider reads the active org, its branding, and the resolved theme, then
// injects CSS variables on <html>. Mock the data sources so the test drives the
// branding values directly and pins the theme for deterministic colour math.
const brandingData = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@/app/features/settings/branding/hooks/queries', () => ({
  useBranding: () => ({ data: brandingData.current, refetch: vi.fn() }),
}));

vi.mock('@/app/lib/active-organization', () => ({
  useActiveOrganizationId: () => 'org_1',
}));

vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

// Kept out of the test's way: the title-suffix effect only runs with an appName,
// and the router is never invalidated in these cases.
vi.mock('@/app/lib/title-suffix', () => ({ setTitleSuffix: () => false }));
vi.mock('@/app/router', () => ({ router: { invalidate: vi.fn() } }));

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

afterEach(() => {
  brandingData.current = undefined;
  document.documentElement.removeAttribute('style');
});

describe('BrandingProvider CSS injection', () => {
  it('maps the brand colour onto the design-system primary-action token', () => {
    // Regression for #2394: the brand colour was injected only as `--primary`,
    // which the primary Button (`bg-accent-base`) does not consume — so setting
    // it had no visible effect on primary UI. It must also drive the canonical
    // `@tale/ui` accent token the Button actually reads.
    brandingData.current = { brandColor: '#FF0055' };

    render(<BrandingProvider>content</BrandingProvider>);

    const expected = adjustColorForTheme('#FF0055', 'light').toLowerCase();
    expect(readVar('--color-accent-base').toLowerCase()).toBe(expected);
    expect(readVar('--color-accent-fg')).not.toBe('');
    // The legacy token stays wired too (badges / chat cards consume it).
    expect(readVar('--primary')).not.toBe('');
  });

  it('does not touch the accent token when no brand colour is set', () => {
    brandingData.current = {};

    render(<BrandingProvider>content</BrandingProvider>);

    expect(readVar('--color-accent-base')).toBe('');
    expect(readVar('--primary')).toBe('');
  });
});
