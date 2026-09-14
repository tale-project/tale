import '@testing-library/jest-dom/vitest';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { ColorPickerInput } from './color-picker-input';
import { ImageUploadField } from './image-upload-field';

import '@/app/globals.css';

vi.mock('../hooks/mutations', () => ({
  useSaveImage: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(cleanup);

it('keeps branding control dimensions, labels and inputs while masked', () => {
  const fixture = (loading: boolean) => (
    <Skeletonize loading={loading}>
      <div className="flex items-start gap-4" style={{ width: 760 }}>
        <ColorPickerInput label="Accent" value="#123456" onChange={vi.fn()} />
        <ImageUploadField
          organizationId="example"
          imageType="favicon-light"
          label="Light"
          ariaLabel="Upload favicon"
          onUpload={vi.fn()}
        />
      </div>
    </Skeletonize>
  );
  const { container, rerender } = render(fixture(false));
  const controls = Array.from(container.querySelectorAll('button, input'));
  const bounds = () =>
    Array.from(container.querySelectorAll('button, input'), (element) => {
      const { width, height, x, y } = element.getBoundingClientRect();
      return { width, height, x, y };
    });
  const loadedBounds = bounds();

  rerender(fixture(true));

  expect(bounds()).toEqual(loadedBounds);
  expect(Array.from(container.querySelectorAll('button, input'))).toEqual(
    controls,
  );
  expect(container.querySelectorAll('[data-skeleton-mask]')).toHaveLength(2);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('Accent')).toBeVisible();
  expect(screen.getByText('Light')).toBeVisible();

  rerender(fixture(false));
  expect(bounds()).toEqual(loadedBounds);
});
