import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render } from '@/tests/utils/render';

import { DataTableFilters, DataTableToolbar } from './data-table-filters';

import '../../globals.css';

afterEach(() => {
  cleanup();
});

function renderToolbar(width: number) {
  return render(
    <div style={{ width }}>
      <DataTableToolbar
        action={
          <button type="button" className="h-9 px-4 whitespace-nowrap">
            Create knowledge entry
          </button>
        }
      >
        <DataTableFilters
          search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        />
      </DataTableToolbar>
    </div>,
  );
}

function box(element: Element) {
  return element.getBoundingClientRect();
}

// The column a list lives in is often far narrower than the viewport (a
// 768px window leaves ~400px beside the rail and a section panel). What the
// toolbar does with too little room is layout — only a real engine answers it.
describe('DataTableToolbar (real layout)', () => {
  it('keeps controls and action on one line when the column holds both', async () => {
    await page.viewport(1280, 800);
    const { container } = renderToolbar(900);
    const search = screen.getByRole('textbox');
    const action = screen.getByRole('button', {
      name: 'Create knowledge entry',
    });
    expect(box(action).top).toBeCloseTo(box(search).top, 0);
    // Opposite the controls: flush with the column's right edge.
    expect(box(action).right).toBeCloseTo(
      box(container.firstElementChild as Element).right,
      0,
    );
  });

  it('moves the action to a line of its own instead of pushing it past the edge', async () => {
    await page.viewport(1280, 800);
    const { container } = renderToolbar(400);
    const column = box(container.firstElementChild as Element);
    const search = screen.getByRole('textbox');
    const action = screen.getByRole('button', {
      name: 'Create knowledge entry',
    });
    expect(box(action).top).toBeGreaterThanOrEqual(box(search).bottom);
    expect(box(action).right).toBeLessThanOrEqual(column.right + 0.5);
    expect(box(action).right).toBeCloseTo(column.right, 0);
    expect(box(search).right).toBeLessThanOrEqual(column.right + 0.5);
  });

  it('lets the search yield width in a column narrower than its 18rem', async () => {
    await page.viewport(1280, 800);
    const { container } = renderToolbar(260);
    const column = box(container.firstElementChild as Element);
    // Every control stays inside the column — the search box gives up width
    // rather than pushing its filter button or the action past the edge.
    for (const element of container.querySelectorAll('input, button')) {
      expect(box(element).right).toBeLessThanOrEqual(column.right + 0.5);
    }
    expect(box(screen.getByRole('textbox')).width).toBeLessThan(288);
  });

  it('gives the action a full-width row beneath the controls on a phone', async () => {
    await page.viewport(390, 800);
    const { container } = renderToolbar(358);
    const column = box(container.firstElementChild as Element);
    const search = screen.getByRole('textbox');
    const action = screen.getByRole('button', {
      name: 'Create knowledge entry',
    });
    expect(box(action).top).toBeGreaterThanOrEqual(box(search).bottom);
    expect(box(action).width).toBeCloseTo(column.width, 0);
    // The search row spans the bar too.
    expect(box(search).left).toBeCloseTo(column.left, 0);
  });
});
