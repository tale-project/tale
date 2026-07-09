import { AppShell } from '@tale/ui/app-shell';
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { FeatureHero } from './feature-hero';

beforeAll(() => {
  // SectionHeading wraps copy in Reveal (framer-motion whileInView).
  global.IntersectionObserver = class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

describe('FeatureHero', () => {
  it('places the product demo on an inset rounded DemoStage, not the full-bleed hero band', () => {
    const { container } = render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <FeatureHero
          title="Agents"
          description="Dock coding agents beside in-product ones."
          visual={<span data-testid="feature-visual">demo</span>}
          showCtas={false}
        />
      </AppShell>,
    );

    const visual = container.querySelector('[data-testid="feature-visual"]');
    const stage = visual?.closest('.bg-surface-wash');
    expect(stage).toBeTruthy();
    expect(stage?.className).toMatch(/rounded-2xl/);
    expect(stage?.className).not.toMatch(/border-y/);
  });
});
