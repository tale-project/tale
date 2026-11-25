import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { FeatureHero } from './feature-hero';

describe('FeatureHero', () => {
  it('places the product demo on an inset rounded section DemoStage', () => {
    const { container } = render(
      <FeatureHero
        title="Agents"
        description="Dock coding agents beside in-product ones."
        visual={<span data-testid="feature-visual">demo</span>}
      />,
    );

    const visual = container.querySelector('[data-testid="feature-visual"]');
    const stage = visual?.closest('.demo-stage');
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

  it('keeps split-hero actions and proof before its unwrapped visual in reading order', () => {
    const { container, getByRole, getByText } = render(
      <FeatureHero
        layout="split"
        visualTreatment="plain"
        title="Build your first project"
        description="Choose the guide for your next step."
        actions={<button type="button">Search guides</button>}
        proof={<p>Open source. Self-host or use Cloud.</p>}
        visual={
          <div role="img" aria-label="A completed project">
            Ready
          </div>
        }
      />,
    );

    const action = getByRole('button', { name: 'Search guides' });
    const proof = getByText('Open source. Self-host or use Cloud.');
    const visual = getByRole('img', { name: 'A completed project' });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(
      action.compareDocumentPosition(proof) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      proof.compareDocumentPosition(visual) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(visual.closest('.demo-stage')).toBeNull();
    expect(action.closest('[inert]')).toBeNull();
  });
});
