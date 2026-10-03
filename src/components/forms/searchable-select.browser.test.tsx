import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

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
