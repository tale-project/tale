import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { StatCard, StatCardGrid } from './stat-card-grid';

import '../../globals.css';

afterEach(() => {
  cleanup();
});

function renderStrip(width: number) {
  render(
    <div style={{ width }}>
      <StatCardGrid>
        <StatCard label="Assistant turns" value="9" />
        <StatCard label="Error rate" value="11.1%" />
        <StatCard label="Blocked rate" value="0%" />
        <StatCard label="Guardrail events" value="0" />
      </StatCardGrid>
    </div>,
  );
}

function rowsOfCards(): number {
  const tops = new Set(
    ['Assistant turns', 'Error rate', 'Blocked rate', 'Guardrail events'].map(
      (label) =>
        Math.round(screen.getByText(label).getBoundingClientRect().top),
    ),
  );
  return tops.size;
}

// A metrics page sits beside the rail and the settings panel: on a desktop
// window its strip can be ~400px wide. The column count must follow the
// strip's width, which only a real engine (container queries) measures.
describe('StatCardGrid columns (real layout)', () => {
  it('stacks four cards two by two in a narrow column on a wide window', async () => {
    await page.viewport(1280, 800);
    renderStrip(400);
    expect(rowsOfCards()).toBe(2);
  });

  it('lays four cards in one row once the strip is 36rem wide', async () => {
    await page.viewport(1280, 800);
    renderStrip(660);
    expect(rowsOfCards()).toBe(1);
  });
});
