import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutateAsync = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
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
  it('returns the full mutation result from useConvexMutation', () => {
    const result = useBulkCreateVendors();
    expect(result).toHaveProperty('mutateAsync', mockMutateAsync);
    expect(result).toHaveProperty('isPending', false);
  });
});

describe('useDeleteVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full mutation result from useConvexMutation', () => {
    const result = useDeleteVendor();
    expect(result).toHaveProperty('mutateAsync', mockMutateAsync);
    expect(result).toHaveProperty('isPending', false);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: deleteVendor } = useDeleteVendor();

    await deleteVendor({ vendorId: toId<'vendors'>('vendor-123') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ vendorId: 'vendor-123' });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: deleteVendor } = useDeleteVendor();

    await expect(
      deleteVendor({ vendorId: toId<'vendors'>('vendor-789') }),
    ).rejects.toThrow('Delete failed');
  });
});

describe('useUpdateVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full mutation result from useConvexMutation', () => {
    const result = useUpdateVendor();
    expect(result).toHaveProperty('mutateAsync', mockMutateAsync);
    expect(result).toHaveProperty('isPending', false);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateVendor } = useUpdateVendor();

    await updateVendor({
      vendorId: toId<'vendors'>('vendor-123'),
      name: 'Updated Name',
      email: 'new@example.com',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      vendorId: 'vendor-123',
      name: 'Updated Name',
      email: 'new@example.com',
    });
  });

  it('calls mutateAsync with only vendorId when no fields updated', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateVendor } = useUpdateVendor();

    await updateVendor({ vendorId: toId<'vendors'>('vendor-456') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ vendorId: 'vendor-456' });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateVendor } = useUpdateVendor();

    await expect(
      updateVendor({ vendorId: toId<'vendors'>('vendor-789'), name: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
