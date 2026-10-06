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
