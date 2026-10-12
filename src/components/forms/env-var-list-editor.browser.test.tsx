import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { EnvVarListEditor } from './env-var-list-editor';

import '@tale/ui/globals.css';

afterEach(cleanup);

describe('environment editor loading layout', () => {
  it.each([false, true])(
    'preserves real row geometry with forceSecret=%s',
    (forceSecret) => {
      const onSet = vi.fn().mockResolvedValue(undefined);
      const rows = ['FIRST', 'SECOND', 'THIRD'].map((key) => ({
        key,
        isSecret: forceSecret,
        value: 'example',
      }));
      const fixture = (isLoading: boolean) => (
        <div style={{ width: 760 }}>
          <EnvVarListEditor
            forceSecret={forceSecret}
            isLoading={isLoading}
            rows={isLoading ? undefined : rows}
            onSet={onSet}
            onDelete={vi.fn().mockResolvedValue(undefined)}
          />
        </div>
      );
      const { container, rerender } = render(fixture(true));
      const bounds = () =>
        Array.from(container.querySelectorAll('input, button'), (element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        });
      const loadingBounds = bounds();
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add variable' }),
      ).toBeDisabled();
      expect(onSet).not.toHaveBeenCalled();

      rerender(fixture(false));

      expect(bounds()).toEqual(loadingBounds);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add variable' }),
      ).toBeEnabled();
      expect(onSet).not.toHaveBeenCalled();
    },
  );
});
