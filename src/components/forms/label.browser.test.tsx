import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { Alert } from '../feedback/alert';
import { Button } from '../primitives/button';
import { Label } from './label';
import { Textarea } from './textarea';

import '@tale/ui/globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe.each(['light', 'dark'])(
  'field label and validation contrast (%s)',
  (theme) => {
    it.each(['bg-background', 'bg-card', 'bg-muted'])(
      'keeps error labels and explanations readable on %s',
      async (surface) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const { container } = render(
          <div className={`${surface} p-4`}>
            <Textarea
              label="Description"
              defaultValue="A legacy description exceeds the task limit."
              errorMessage="Shorten this description before saving."
            />
          </div>,
        );
        const result = await axe.run(container, {
          runOnly: ['color-contrast'],
        });
        expect(result.violations).toEqual([]);
        expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
          true,
        );
      },
    );

    it('keeps the destructive alert and action readable on the form surface', async () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className="bg-background p-4">
          <Alert
            variant="destructive"
            title="The description could not be saved"
            description="Shorten it before trying again."
          />
          <Button variant="destructive">Discard description</Button>
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
