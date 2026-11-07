import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { SchemaTree, type SchemaTreeSchema } from './schema-tree';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const SHAPE: SchemaTreeSchema = {
  type: 'object',
  required: ['reviewed'],
  properties: {
    reviewed: { type: 'integer', description: 'How many issues were read.' },
    actionable: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, score: { type: 'number' } },
      },
    },
  },
};

describe.each(['light', 'dark'])('SchemaTree (%s)', (theme) => {
  it.each(['bg-background', 'bg-card', 'bg-bg-elevated'])(
    'reads at AA on %s',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} p-4`}>
          <SchemaTree
            schema={SHAPE}
            tagOf={(path) =>
              path[0] === 'reviewed' ? 'from Report' : undefined
            }
            maybeEmpty={(path) => path[0] === 'actionable'}
            typeScript="{ reviewed: number; actionable: { title: string }[] }"
          />
        </div>,
      );
      const result = await axe.run(container, {
        runOnly: ['color-contrast', 'list', 'listitem', 'aria-allowed-attr'],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );
});

it('opens the TypeScript shape from the keyboard', async () => {
  render(
    <>
      <button type="button">Before</button>
      <SchemaTree schema={SHAPE} typeScript="{ reviewed: number }" />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Before' }));
  await userEvent.keyboard('{Tab}');
  const summary = screen.getByText('Show as TypeScript');
  expect(summary).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  const details = summary.closest('details') as HTMLDetailsElement;
  expect(details).toHaveAttribute('open');
  const code = details.querySelector('code');
  expect(code).toBeVisible();
  expect(code?.textContent).toContain('reviewed: number');
});
