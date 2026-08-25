import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_WORKBENCH_GRID,
} from './workbench';

/**
 * The workbench row must be height-capped. `min-h` of the viewport remainder
 * alone lets the inspector's content grow the grid, which stretches the canvas
 * when a node is selected.
 */
describe('AUTOMATION_WORKBENCH_GRID', () => {
  it('caps the desktop row so the inspector cannot stretch the canvas', () => {
    expect(AUTOMATION_WORKBENCH_GRID).toContain(
      'lg:h-[max(24rem,calc(100dvh-12rem))]',
    );
    expect(AUTOMATION_WORKBENCH_GRID).toContain('lg:grid-rows-[minmax(0,1fr)]');
    expect(AUTOMATION_WORKBENCH_GRID).toContain('lg:overflow-hidden');
    expect(AUTOMATION_WORKBENCH_GRID).not.toContain(
      'min-h-[max(24rem,calc(100dvh-12rem))]',
    );
  });
});

describe('AUTOMATION_WORKBENCH_CANVAS_SLOT', () => {
  it('is a positioning context so canvas chrome can overlay without growing the row', () => {
    expect(AUTOMATION_WORKBENCH_CANVAS_SLOT).toContain('relative');
    expect(AUTOMATION_WORKBENCH_CANVAS_SLOT).toContain('overflow-hidden');
  });
});
