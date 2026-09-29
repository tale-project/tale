import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DemoStage } from './demo-stage';

describe('DemoStage', () => {
  it('uses full-bleed edges for the homepage hero band (no radius)', () => {
    const { container } = render(
      <DemoStage variant="hero">
        <span>demo</span>
      </DemoStage>,
    );
    const stage = container.firstElementChild;
    expect(stage?.className).toMatch(/border-y/);
    expect(stage?.className).not.toMatch(/rounded-/);
  });

  it('rounds the inset section stage used under tour rows and feature heroes', () => {
    const { container } = render(
      <DemoStage variant="section">
        <span>demo</span>
      </DemoStage>,
    );
    const stage = container.firstElementChild;
    expect(stage?.className).toMatch(/rounded-2xl/);
    expect(stage?.className).toMatch(/md:rounded-3xl/);
    expect(stage?.className).toMatch(/\bborder\b/);
  });
});
