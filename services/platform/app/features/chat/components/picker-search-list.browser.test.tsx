import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { PickerSearchList } from './picker-search-list';

import '@/app/globals.css';

afterEach(cleanup);

it('heads each group outside its options, keeping keys, positions and search to the options', async () => {
  const onSelect = vi.fn();
  // Two providers listing the same sixty models: more rows than the list
  // renders at once.
  const options = ['Gateway A', 'Gateway B'].flatMap((label) =>
    Array.from({ length: 60 }, (_, index) => ({
      key: `${label}:${index}`,
      label: `Model ${index + 1}`,
      ariaLabel: `${label} · Model ${index + 1}`,
      search: `${label} Model ${index + 1}`,
      group: { key: label.toLowerCase().replace(' ', '-'), label },
      onSelect: () => onSelect(label, index),
    })),
  );
  render(
    <div role="menu" aria-label="Model" style={{ width: 240 }}>
      <PickerSearchList options={options} emptyHint="No models" />
    </div>,
  );
  const header = screen.getByText('Gateway A');
  expect(header).toHaveAttribute('role', 'presentation');
  expect(header).not.toHaveAttribute('tabindex');
  const first = screen.getByRole('menuitemradio', {
    name: 'Gateway A · Model 1',
  });
  expect(first).toHaveTextContent(/^Model 1$/);
  expect(first).toHaveAttribute('aria-posinset', '1');
  expect(first).toHaveAttribute('aria-setsize', '120');
  first.focus();
  await userEvent.keyboard('{End}');
  await expect
    .poll(() => document.activeElement?.getAttribute('aria-label'))
    .toBe('Gateway B · Model 60');
  expect(document.activeElement).toHaveAttribute('aria-posinset', '120');

  await page.getByRole('textbox').fill('Model 60');
  await expect.poll(() => screen.getAllByRole('menuitemradio').length).toBe(2);
  expect(screen.getByText('Gateway A')).toBeInTheDocument();
  expect(screen.getByText('Gateway B')).toBeInTheDocument();
  screen.getByRole('menuitemradio', { name: 'Gateway A · Model 60' }).focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(
    screen.getByRole('menuitemradio', { name: 'Gateway B · Model 60' }),
  );
  expect(document.activeElement).toHaveAttribute('aria-posinset', '2');
  expect(document.activeElement).toHaveAttribute('aria-setsize', '2');

  await page.getByRole('textbox').fill('Gateway B Model 7');
  await expect.poll(() => screen.queryByText('Gateway A')).toBeNull();
  await page
    .getByRole('menuitemradio', { name: 'Gateway B · Model 7' })
    .click();
  expect(onSelect).toHaveBeenCalledWith('Gateway B', 6);
});

it('keeps two groups named alike apart by their keys', () => {
  // Two org-defined providers whose admins gave them one name.
  const options = ['gateway-eu', 'gateway-us'].map((key) => ({
    key: `${key}:luna`,
    label: 'GPT 5.6 Luna',
    group: { key, label: 'Gateway' },
    onSelect: () => undefined,
  }));
  render(
    <div role="menu" aria-label="Model" style={{ width: 240 }}>
      <PickerSearchList options={options} emptyHint="No models" />
    </div>,
  );
  expect(screen.getAllByText('Gateway')).toHaveLength(2);
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
});

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
