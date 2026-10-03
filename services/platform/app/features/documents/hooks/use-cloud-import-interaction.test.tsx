import { renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { expect, it } from 'vitest';

import { useCloudImportInteraction } from './use-cloud-import-interaction';

it('keeps an open interaction through rerenders, but never through close/reopen or unmount', () => {
  const { result, rerender, unmount } = renderHook(
    ({ open }) => useCloudImportInteraction(open, 'org-1', undefined),
    {
      initialProps: { open: true },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  );
  const first = result.current();
  expect(first()).toBe(true);
  rerender({ open: true });
  expect(first()).toBe(true);
  rerender({ open: false });
  expect(first()).toBe(false);
  const closed = result.current();
  expect(closed()).toBe(false);
  rerender({ open: true });
  expect(first()).toBe(false);
  expect(closed()).toBe(false);
  const second = result.current();
  expect(second()).toBe(true);
  unmount();
  expect(second()).toBe(false);
});

it('does not hand an old result to a different organization or destination', () => {
  const { result, rerender } = renderHook(
    ({ organizationId, folderId }) =>
      useCloudImportInteraction(true, organizationId, folderId),
    { initialProps: { organizationId: 'org-1', folderId: 'folder-1' } },
  );
  const first = result.current();
  rerender({ organizationId: 'org-1', folderId: 'folder-2' });
  expect(first()).toBe(false);
  const second = result.current();
  expect(second()).toBe(true);
  rerender({ organizationId: 'org-2', folderId: 'folder-2' });
  expect(second()).toBe(false);
  expect(result.current()()).toBe(true);
});
