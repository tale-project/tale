import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { FlowLegend, type FlowLegendEntry } from './flow-legend';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const ENTRIES: FlowLegendEntry[] = [
  { id: 'data', swatch: { edge: 'data' }, label: 'Reads the output above' },
  { id: 'order', swatch: { edge: 'order' }, label: 'Runs after it' },
  { id: 'yes', swatch: { edge: 'branch-yes' }, label: 'Yes' },
  { id: 'no', swatch: { edge: 'branch-no' }, label: 'No' },
  {
    id: 'done',
    swatch: { edge: 'completion' },
    label: 'The run ends after it',
  },
  { id: 'dashed', swatch: { node: 'dashed' }, label: 'May not run' },
  { id: 'frame', swatch: { node: 'frame' }, label: 'Runs once per item' },
];

describe('FlowLegend', () => {
  it.each(['light', 'dark'])(
    'opens how to read the chart, each mark in its real colour (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      render(<FlowLegend entries={ENTRIES} />);
      const button = screen.getByRole('button', { name: 'Legend' });
      await userEvent.click(button);
      const dialog = await screen.findByRole('dialog', {
        name: 'How to read the chart',
      });
      // The popover fades in; colours are judged once it is fully there.
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished),
      );
      for (const entry of ENTRIES)
        expect(dialog).toHaveTextContent(entry.label);
      // Every line keeps 3:1 on the popover.
      for (const path of dialog.querySelectorAll('svg path:first-child')) {
        expect(
          ratioAgainst(dialog, getComputedStyle(path).stroke),
          `${theme} swatch`,
        ).toBeGreaterThanOrEqual(3);
      }
      const result = await axe.run(dialog, {
        runOnly: ['color-contrast', 'aria-dialog-name', 'list', 'listitem'],
      });
      expect(result.violations).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(button);
    },
  );

  it('renders nothing without entries', () => {
    const { container } = render(<FlowLegend entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
