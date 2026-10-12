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
      const { user } = renderPicker(triggerWidth);
      await user.click(screen.getByRole('button', { name: 'Review' }));
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
      await user.keyboard('{Escape}');
      await expect
        .poll(() => document.activeElement)
        .toBe(screen.getByRole('button', { name: 'Review' }));
    });
  }

  it('preserves a desktop field width and keyboard selection', async () => {
    await page.viewport(1280, 800);
    const { user, onValueChange } = renderPicker(420);
    const trigger = screen.getByRole('button', { name: 'Review' });
    await user.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Reviewer' });
    expect(panel.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      trigger.getBoundingClientRect().width,
    );
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('person');
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  for (const variant of ['default', 'switcher'] as const) {
    it(`keeps the search, last option and localized footer reachable in a short ${variant} picker`, async () => {
      await page.viewport(375, 430);
      const onValueChange = vi.fn();
      const { user } = render(
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
      await user.click(trigger);
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
      await user.keyboard('{End}');
      const last = screen.getByRole('option', { name: 'Reviewer 20' });
      await expect
        .poll(() => last.getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
      expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        panel.getBoundingClientRect().top,
      );
      await user.keyboard('{Enter}');
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
