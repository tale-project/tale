import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DemoStage } from './demo-stage';

describe('DemoStage', () => {
  it('frames the hero inside the shared page gutters', () => {
    const { container } = render(
      <DemoStage variant="hero">
        <span>demo</span>
      </DemoStage>,
    );
    const stage = container.firstElementChild;
    expect(stage?.className).toMatch(/\bborder\b/);
    expect(stage?.className).toMatch(/sm:rounded-3xl/);
  });

  it('rounds the inset section stage used under tour rows and feature heroes', () => {
    const { container } = render(
      <DemoStage variant="section">
        <span>demo</span>
      </DemoStage>,
    );
    const stage = container.firstElementChild;
    expect(stage?.className).toMatch(/rounded-2xl/);
    expect(stage?.className).toMatch(/\bborder\b/);
  });
});
