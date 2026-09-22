import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { FeatureHero } from './feature-hero';

describe('FeatureHero', () => {
  it('places the product demo on an inset rounded DemoStage, not the full-bleed hero band', () => {
    const { container } = render(
      <FeatureHero
        title="Agents"
        description="Dock coding agents beside in-product ones."
        visual={<span data-testid="feature-visual">demo</span>}
      />,
    );

    const visual = container.querySelector('[data-testid="feature-visual"]');
    const stage = visual?.closest('.bg-surface-wash');
    expect(stage).toBeTruthy();
    expect(stage?.className).toMatch(/rounded-2xl/);
    expect(stage?.className).not.toMatch(/border-y/);
  });

  it('renders the host-supplied actions under the copy', () => {
    const { getByRole } = render(
      <FeatureHero
        title="Agents"
        description="Dock coding agents beside in-product ones."
        actions={<a href="/request-demo">Request a demo</a>}
      />,
    );

    expect(getByRole('link', { name: 'Request a demo' })).toBeInTheDocument();
  });
});
