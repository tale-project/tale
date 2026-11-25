import '@testing-library/jest-dom/vitest';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { JsonInput } from './json-input';

import '@tale/ui/globals.css';

afterEach(cleanup);

it('reserves the JSON editor size while its viewer chunk loads', async () => {
  const fixture = (loading: boolean) => (
    <div style={{ width: 760 }}>
      <Skeletonize loading={loading}>
        <JsonInput
          label="Configuration"
          value='{"key":"example"}'
          onChange={vi.fn()}
        />
      </Skeletonize>
      <div data-testid="after">Following content</div>
    </div>
  );
  const { container, rerender } = render(fixture(false));
  const editor = container.querySelector('[role="group"]');
  if (!editor) throw new Error('Missing editor surface');
  const bounds = () => {
    const { width, height } = editor.getBoundingClientRect();
    return { width, height, after: screen.getByTestId('after').offsetTop };
  };
  const loadingBounds = bounds();
  expect(loadingBounds.height).toBeGreaterThanOrEqual(224);

  await waitFor(() => {
    expect(container.querySelector('.react-json-view')).toBeInTheDocument();
  });
  expect(bounds()).toEqual(loadingBounds);

  rerender(fixture(true));
  expect(container.querySelector('[role="group"]')).toBe(editor);
  expect(bounds()).toEqual(loadingBounds);
  expect(screen.getByText('Configuration')).toBeVisible();
});
