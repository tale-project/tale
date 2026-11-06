import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { SearchableSelect } from './searchable-select';

import '../../globals.css';

const ROUTING_HINT =
  'People need edit access. Agents need the task review permission and must not review their own work.';

afterEach(cleanup);

function renderPicker(triggerWidth: number) {
  const onValueChange = vi.fn();
  const result = render(
    <div style={{ padding: 16 }}>
      <SearchableSelect
        aria-label="Reviewer"
        searchPlaceholder="Search people and agents"
        value="reviewer"
        onValueChange={onValueChange}
        options={[
          {
            value: 'implementation',
            label: 'Implementation agent',
            description:
              'Choose someone other than the agent that did the work.',
            disabled: true,
          },
          { value: 'reviewer', label: 'Independent reviewer' },
          { value: 'person', label: 'Eligible person' },
        ]}
        trigger={
          <button type="button" style={{ width: triggerWidth }}>
            Review
          </button>
        }
        footer={<p className="px-2 py-1 text-xs">{ROUTING_HINT}</p>}
      />
    </div>,
  );
  return { ...result, onValueChange };
}

describe('SearchableSelect viewport containment (real layout)', () => {
  for (const triggerWidth of [32, 600]) {
    it(`keeps a long footer and a ${triggerWidth}px trigger inside a narrow viewport`, async () => {
      await page.viewport(375, 812);
      renderPicker(triggerWidth);
      await page.getByRole('button', { name: 'Review' }).click();
      const panel = await screen.findByRole('dialog', { name: 'Reviewer' });
      await expect
        .poll(() => panel.getBoundingClientRect().right)
        .toBeLessThanOrEqual(window.innerWidth - 8);
      expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
      const hint = screen.getByText(ROUTING_HINT);
      expect(hint.getBoundingClientRect().right).toBeLessThanOrEqual(
        panel.getBoundingClientRect().right,
      );
      const input = screen.getByRole('combobox');
      expect(input).toHaveFocus();
      expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(
        panel.getBoundingClientRect().right,
      );
      await userEvent.keyboard('{Escape}');
      await expect
        .poll(() => document.activeElement)
        .toBe(screen.getByRole('button', { name: 'Review' }));
    });
  }

  it('preserves a desktop field width and keyboard selection', async () => {
    await page.viewport(1280, 800);
    const { onValueChange } = renderPicker(420);
    const trigger = screen.getByRole('button', { name: 'Review' });
    await page.getByRole('button', { name: 'Review' }).click();
    const panel = await screen.findByRole('dialog', { name: 'Reviewer' });
    expect(panel.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      trigger.getBoundingClientRect().width,
    );
    expect(screen.getByRole('combobox')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('person');
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  for (const variant of ['default', 'switcher'] as const) {
    it(`keeps the search, last option and localized footer reachable in a short ${variant} picker`, async () => {
      await page.viewport(375, 430);
      const onValueChange = vi.fn();
      render(
        <div style={{ padding: '200px 16px 0' }}>
          <SearchableSelect
            aria-label="Reviewer"
            searchPlaceholder="Personen und Agenten suchen"
            variant={variant}
            value={null}
            onValueChange={onValueChange}
            options={Array.from({ length: 20 }, (_, index) => ({
              value: String(index),
              label: `Reviewer ${index + 1}`,
            }))}
            trigger={<button type="button">Review</button>}
            footer={
              <p className="px-2 py-1 text-xs">
                Personen brauchen Bearbeitungsrechte. Agenten brauchen die
                Berechtigung für Aufgabenreviews und dürfen ihre eigene Arbeit
                nicht prüfen.
              </p>
            }
          />
        </div>,
      );
      const trigger = screen.getByRole('button', { name: 'Review' });
      await page.getByRole('button', { name: 'Review' }).click();
      const panel = await screen.findByRole('dialog', { name: 'Reviewer' });
      await expect
        .poll(() => panel.getBoundingClientRect().top)
        .toBeGreaterThanOrEqual(8);
      expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        window.innerHeight - 8,
      );
      const input = screen.getByRole('combobox');
      expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panel.getBoundingClientRect().top,
      );
      const footer = screen.getByText(/Personen brauchen Bearbeitungsrechte/);
      panel.scrollTop = panel.scrollHeight;
      expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        panel.getBoundingClientRect().bottom,
      );
      expect(footer.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panel.getBoundingClientRect().top,
      );
      await page
        .getByRole('option', { name: 'Reviewer 2', exact: true })
        .hover();
      await userEvent.keyboard('{End}');
      await expect.poll(() => activeOption()?.textContent).toBe('Reviewer 20');
      const last = screen.getByRole('option', { name: 'Reviewer 20' });
      await expect
        .poll(() => last.getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
      expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panel.getBoundingClientRect().top,
      );
      await page
        .getByRole('option', { name: 'Reviewer 18', exact: true })
        .hover();
      await expect.poll(() => activeOption()?.textContent).toBe('Reviewer 18');
      await userEvent.keyboard('{End}');
      await expect.poll(() => activeOption()?.textContent).toBe('Reviewer 20');
      await userEvent.keyboard('{Enter}');
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith('19');
      await expect.poll(() => document.activeElement).toBe(trigger);
    });
  }
});

const options = Array.from({ length: 2000 }, (_, index) => ({
  value: `project-${index}`,
  label: `Project ${String(index + 1).padStart(4, '0')}`,
  description: index % 3 === 0 ? 'A project with a description.' : undefined,
  disabled: index === 1998,
}));

function activeOption() {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
}

function visibleInside(row: HTMLElement | null, scroller: HTMLElement) {
  if (row === null) return false;
  const box = row.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  return (
    box.height > 0 &&
    box.top >= viewport.top - 1 &&
    box.bottom <= viewport.bottom + 1
  );
}

it('opens at a far selected project while mounting a bounded option window', async () => {
  await page.viewport(1280, 800);
  const onValueChange = vi.fn();
  render(
    <SearchableSelect
      value="project-1999"
      onValueChange={onValueChange}
      options={options}
      aria-label="Project"
      searchPlaceholder="Search projects"
    />,
  );
  await page.getByRole('button', { name: 'Project 2000' }).click();
  const list = screen.getByRole('listbox');
  await expect.poll(() => activeOption()?.textContent).toBe('Project 2000');
  await expect.poll(() => visibleInside(activeOption(), list)).toBe(true);
  expect(screen.getAllByRole('option').length).toBeLessThan(50);
  expect(activeOption()).toHaveAttribute('aria-posinset', '2000');
  expect(activeOption()).toHaveAttribute('aria-setsize', '2000');
  await userEvent.keyboard('{Enter}');
  expect(onValueChange).toHaveBeenCalledWith('project-1999');
});

it('keeps keyboard highlights mounted across the full list and searches offscreen projects', async () => {
  const onValueChange = vi.fn();
  render(
    <SearchableSelect
      value={null}
      onValueChange={onValueChange}
      options={options}
      placeholder="Pick project"
      aria-label="Project"
      searchPlaceholder="Search projects"
    />,
  );
  await page.getByRole('button', { name: 'Pick project' }).click();
  const list = screen.getByRole('listbox');
  await userEvent.keyboard('{End}');
  await expect.poll(() => activeOption()?.textContent).toBe('Project 2000');
  await expect.poll(() => visibleInside(activeOption(), list)).toBe(true);
  await userEvent.keyboard('{ArrowUp}');
  await expect.poll(() => activeOption()?.textContent).toBe('Project 1998');
  await userEvent.keyboard('{Home}');
  await expect
    .poll(() => activeOption()?.textContent)
    .toContain('Project 0001');
  await expect.poll(() => visibleInside(activeOption(), list)).toBe(true);
  expect(screen.getAllByRole('option').length).toBeLessThan(50);
  await page.getByRole('combobox').fill('Project 1732');
  await expect.poll(() => screen.getAllByRole('option').length).toBe(1);
  await expect
    .poll(() => activeOption()?.textContent)
    .toContain('Project 1732');
  await userEvent.keyboard('{Enter}');
  expect(onValueChange).toHaveBeenCalledWith('project-1731');
});

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

it('keeps the filtered rows and the query while the closing popover fades out', async () => {
  await page.viewport(800, 600);
  const onSearchChange = vi.fn();
  render(
    <div style={{ padding: '480px 16px 0' }}>
      <SearchableSelect
        value={null}
        onValueChange={vi.fn()}
        onSearchChange={onSearchChange}
        options={options}
        side="top"
        placeholder="Pick project"
        aria-label="Project"
        searchPlaceholder="Search projects"
      />
    </div>,
  );
  const trigger = screen.getByRole('button', { name: 'Pick project' });
  await page.getByRole('button', { name: 'Pick project' }).click();
  const panel = await screen.findByRole('dialog', { name: 'Project' });
  await page.getByRole('combobox').fill('Project 001');
  await expect.poll(() => screen.getAllByRole('option').length).toBe(10);
  await Promise.all(
    panel.getAnimations().map((animation) => animation.finished),
  );
  await nextFrame();
  await nextFrame();
  const rowsInPanel = () =>
    Array.from(
      panel.querySelectorAll('[role="option"]'),
      (option) => option.textContent,
    );
  const openRows = rowsInPanel();
  const openBox = panel.getBoundingClientRect();
  // Above its trigger, a panel that lost its rows would drop towards it.
  expect(openBox.bottom).toBeLessThanOrEqual(
    trigger.getBoundingClientRect().top,
  );

  // Slows the exit fade down, so the closing panel can be read.
  panel.style.setProperty('--duration-short', '60s');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => panel.dataset.state).toBe('closed');
  await nextFrame();
  await nextFrame();
  expect(panel.isConnected).toBe(true);
  expect(rowsInPanel()).toEqual(openRows);
  expect(screen.getByRole('combobox')).toHaveValue('Project 001');
  const closingBox = panel.getBoundingClientRect();
  expect(closingBox.top).toBeCloseTo(openBox.top, 0);
  expect(closingBox.height).toBeCloseTo(openBox.height, 0);
  expect(onSearchChange).not.toHaveBeenCalledWith('');

  for (const animation of panel.getAnimations()) animation.finish();
  await expect.poll(() => panel.isConnected).toBe(false);
  expect(onSearchChange).toHaveBeenLastCalledWith('');
});

it('starts from an empty query when it reopens before the closed popover left the page', async () => {
  const onSearchChange = vi.fn();
  render(
    <SearchableSelect
      value={null}
      onValueChange={vi.fn()}
      onSearchChange={onSearchChange}
      options={options}
      placeholder="Pick project"
      aria-label="Project"
      searchPlaceholder="Search projects"
    />,
  );
  await page.getByRole('button', { name: 'Pick project' }).click();
  const panel = await screen.findByRole('dialog', { name: 'Project' });
  await page.getByRole('combobox').fill('Project 001');
  await expect.poll(() => screen.getAllByRole('option').length).toBe(10);

  // Slows the exit fade down, so the trigger reopens the closing panel.
  panel.style.setProperty('--duration-short', '60s');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => panel.dataset.state).toBe('closed');
  expect(panel.isConnected).toBe(true);
  await page.getByRole('button', { name: 'Pick project' }).click();
  await expect.poll(() => panel.dataset.state).toBe('open');
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(onSearchChange).toHaveBeenLastCalledWith('');
  // The unfiltered list again, which the old query had cut to Project 0010–0019.
  await expect
    .poll(() => screen.getAllByRole('option')[0]?.textContent)
    .toContain('Project 0001');
});
