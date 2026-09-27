import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_EDITOR_WORKBENCH_GRID,
  AUTOMATION_RUN_WORKBENCH_GRID,
  AUTOMATION_WORKBENCH_CANVAS_SLOT,
  AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS,
} from './workbench';

/**
 * Both workbench rows must be height-constrained. `min-h` of the available
 * space alone lets the inspector's content grow the grid, which stretches the
 * canvas when a node is selected.
 */
describe('AUTOMATION_EDITOR_WORKBENCH_GRID', () => {
  it('fills the Editor tab instead of computing a viewport cap', () => {
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).toContain('lg:flex-1');
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).toContain('min-h-[24rem]');
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).not.toContain('100dvh');
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).toContain(
      'lg:grid-rows-[minmax(0,1fr)]',
    );
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).toContain('lg:overflow-hidden');
  });

  it('meets the inspector at its border, with no gutter between them', () => {
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).not.toMatch(/(?:^|\s)gap-/);
  });
});

describe('AUTOMATION_RUN_WORKBENCH_GRID', () => {
  it('caps the desktop row so the inspector cannot stretch the canvas', () => {
    expect(AUTOMATION_RUN_WORKBENCH_GRID).toContain(
      'lg:h-[max(24rem,calc(100dvh-15rem))]',
    );
    expect(AUTOMATION_RUN_WORKBENCH_GRID).toContain(
      'lg:grid-rows-[minmax(0,1fr)]',
    );
    expect(AUTOMATION_RUN_WORKBENCH_GRID).toContain('lg:overflow-hidden');
    expect(AUTOMATION_RUN_WORKBENCH_GRID).not.toContain(
      'min-h-[max(24rem,calc(100dvh-15rem))]',
    );
  });
});

describe('AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS', () => {
  it('is the only place a workbench makes room for the inspector', () => {
    // With no node picked the canvas has the whole row: neither grid
    // reserves the inspector's column on its own.
    expect(AUTOMATION_EDITOR_WORKBENCH_GRID).not.toContain('grid-cols');
    expect(AUTOMATION_RUN_WORKBENCH_GRID).not.toContain('grid-cols');
    expect(AUTOMATION_WORKBENCH_INSPECTOR_COLUMNS).toBe(
      'lg:grid-cols-[minmax(0,1fr)_22rem]',
    );
  });
});

describe('AUTOMATION_WORKBENCH_CANVAS_SLOT', () => {
  it('is a positioning context so canvas chrome can overlay without growing the row', () => {
    expect(AUTOMATION_WORKBENCH_CANVAS_SLOT).toContain('relative');
    expect(AUTOMATION_WORKBENCH_CANVAS_SLOT).toContain('overflow-hidden');
  });
});
