import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { PickerSearchList } from './picker-search-list';

import '@/app/globals.css';

afterEach(cleanup);

it('windows a large picker while preserving full keyboard navigation, search and selection', async () => {
  const onSelect = vi.fn();
  const onPicked = vi.fn();
  const options = Array.from({ length: 1000 }, (_, index) => ({
    key: `project-${index}`,
    label: `Project ${index + 1}`,
    search: `Project ${index + 1}`,
    disabled: index === 998,
    onSelect: () => onSelect(index),
  }));
  render(
    <div role="menu" aria-label="Move to project" style={{ width: 240 }}>
      <PickerSearchList
        options={options}
        emptyHint="No projects"
        onPicked={onPicked}
      />
    </div>,
  );
  const first = screen.getByRole('menuitemradio', { name: 'Project 1' });
  first.focus();
  await userEvent.keyboard('{End}');
  await expect
    .poll(() => document.activeElement?.textContent)
    .toBe('Project 1000');
  expect(document.activeElement).toHaveAttribute('aria-posinset', '1000');
  expect(document.activeElement).toHaveAttribute('aria-setsize', '1000');
  await userEvent.keyboard('{ArrowUp}');
  await expect
    .poll(() => document.activeElement?.textContent)
    .toBe('Project 998');
  await userEvent.keyboard('{Home}');
  await expect
    .poll(() => document.activeElement?.textContent)
    .toBe('Project 1');
  expect(screen.getAllByRole('menuitemradio').length).toBeLessThan(40);
  await page.getByRole('textbox').fill('Project 1000');
  await expect.poll(() => screen.getAllByRole('menuitemradio').length).toBe(1);
  await page.getByRole('menuitemradio', { name: 'Project 1000' }).click();
  expect(onSelect).toHaveBeenCalledWith(999);
  expect(onPicked).toHaveBeenCalledOnce();
});

const long = (index: number) =>
  `A project whose name is far too long for its menu ${index + 1}`;

/** One row that fits a 240px menu, then eight its width cuts. */
function renderCutList() {
  const options = [
    { key: 'short', label: 'Short', onSelect: () => {} },
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `long-${index}`,
      label: long(index),
      onSelect: () => {},
    })),
  ];
  render(
    <div role="menu" aria-label="Move to project" style={{ width: 240 }}>
      <PickerSearchList options={options} emptyHint="No projects" />
    </div>,
  );
}

/** Moves the pointer onto `element` in more than one step, the way a hand
 * does: a tip the pointer leaves closes on a move past its grace area. */
async function pointAt(element: HTMLElement) {
  await userEvent.hover(element, { position: { x: 4, y: 4 } });
  await userEvent.hover(element, { position: { x: 8, y: 8 } });
}

/** Every tip on screen, by the text Radix gives its `role="tooltip"`. */
const tips = () =>
  [...document.querySelectorAll('[role="tooltip"]')].map(
    (node) => node.textContent,
  );

it('holds the tip of a cut row while keyboard focus scrolls the list under it', async () => {
  renderCutList();
  screen.getByRole('menuitemradio', { name: 'Short' }).focus();
  // Each step down scrolls the four-row list under the focused row.
  for (let index = 0; index < 8; index += 1) {
    await userEvent.keyboard('{ArrowDown}');
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe(long(index));
    await expect.poll(tips).toEqual([long(index)]);
  }
  // Escape closes the tip first and leaves the focus where it is.
  await userEvent.keyboard('{Escape}');
  await expect.poll(tips).toEqual([]);
  expect(document.activeElement?.textContent).toBe(long(7));

  await userEvent.keyboard('{ArrowUp}');
  await expect.poll(tips).toEqual([long(6)]);
  // Scrolled out of the list's view, the row lets its tip go.
  screen.getByRole('group').scrollTop = 0;
  await expect.poll(tips).toEqual([]);
  expect(document.activeElement?.textContent).toBe(long(6));
});

it('shows the tip of a cut row on hover, none for a row that fits, and one tip at a time', async () => {
  renderCutList();
  await pointAt(screen.getByRole('menuitemradio', { name: 'Short' }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(tips()).toEqual([]);
  await pointAt(screen.getByRole('menuitemradio', { name: long(0) }));
  await expect.poll(tips).toEqual([long(0)]);
  await pointAt(screen.getByRole('menuitemradio', { name: 'Short' }));
  await expect.poll(tips).toEqual([]);

  // A tip that keyboard focus holds gives way to one the pointer opens.
  screen.getByRole('menuitemradio', { name: 'Short' }).focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  await expect.poll(tips).toEqual([long(1)]);
  await pointAt(screen.getByRole('menuitemradio', { name: long(0) }));
  await expect.poll(tips).toEqual([long(0)]);
  await pointAt(screen.getByRole('menuitemradio', { name: 'Short' }));
  await expect.poll(tips).toEqual([]);
  expect(document.activeElement?.textContent).toBe(long(1));
});
