import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { Label } from './label';

import '@tale/ui/globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe.each(['light', 'dark'])(
  'optional field label contrast (%s)',
  (theme) => {
    it('keeps the optional hint readable on the form surface', async () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className="bg-background p-4">
          <Label htmlFor="optional-field" required={false}>
            Labels
          </Label>
          <input id="optional-field" />
        </div>,
      );
      const result = await axe.run(container, {
        runOnly: ['color-contrast'],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    });
  },
);
