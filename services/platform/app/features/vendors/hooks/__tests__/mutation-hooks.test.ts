import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    vendors: {
      mutations: {
        bulkCreateVendors: 'bulkCreateVendors',
        deleteVendor: 'deleteVendor',
        updateVendor: 'updateVendor',
      },
    },
  },
}));

import {
  useBulkCreateVendors,
  useDeleteVendor,
  useUpdateVendor,
} from '../mutations';

describe('useBulkCreateVendors', () => {
  it('returns the mutation function from useConvexMutation', () => {
    const result = useBulkCreateVendors();
    expect(result).toBe(mockMutationFn);
  });
});

describe('useDeleteVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const result = useDeleteVendor();
    expect(result).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const deleteVendor = useDeleteVendor();

    await deleteVendor({ vendorId: toId<'vendors'>('vendor-123') });

    expect(mockMutationFn).toHaveBeenCalledWith({ vendorId: 'vendor-123' });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Delete failed'));
    const deleteVendor = useDeleteVendor();

    await expect(
      deleteVendor({ vendorId: toId<'vendors'>('vendor-789') }),
    ).rejects.toThrow('Delete failed');
  });
});

describe('useUpdateVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const result = useUpdateVendor();
    expect(result).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const updateVendor = useUpdateVendor();

    await updateVendor({
      vendorId: toId<'vendors'>('vendor-123'),
      name: 'Updated Name',
      email: 'new@example.com',
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      vendorId: 'vendor-123',
      name: 'Updated Name',
      email: 'new@example.com',
    });
  });

  it('calls mutation with only vendorId when no fields updated', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const updateVendor = useUpdateVendor();

    await updateVendor({ vendorId: toId<'vendors'>('vendor-456') });

    expect(mockMutationFn).toHaveBeenCalledWith({ vendorId: 'vendor-456' });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Update failed'));
    const updateVendor = useUpdateVendor();

    await expect(
      updateVendor({ vendorId: toId<'vendors'>('vendor-789'), name: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
