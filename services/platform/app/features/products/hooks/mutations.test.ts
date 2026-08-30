// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The create dialog renders its own duplicate-name / generic error toast, so the
// shared mutation hook must NOT also fire its default generic toast — otherwise
// a duplicate name shows two contradictory toasts. This pins `errorToast: false`
// on the create hook (matching update/delete, which were already opted out).

const useBackendMutation = vi.fn((..._args: unknown[]) => ({
  mutate: vi.fn(),
  isPending: false,
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (...args: unknown[]) => useBackendMutation(...args),
}));

import {
  useCreateProduct,
  useDeleteProduct,
  useUpdateProduct,
} from './mutations';

describe('product mutation hooks', () => {
  it('opts out of the shared generic toast on create (the dialog toasts itself)', () => {
    renderHook(() => useCreateProduct());
    expect(useBackendMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorToast: false }),
    );
  });

  it('opts out of the shared generic toast on update and delete', () => {
    renderHook(() => useUpdateProduct());
    expect(useBackendMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ errorToast: false }),
    );
    renderHook(() => useDeleteProduct());
    expect(useBackendMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ errorToast: false }),
    );
  });
});
