import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toId } from '@/convex/lib/type_cast_helpers';

const mockMutateAsync = vi.fn();

const mockMutationResult = {
  mutate: mockMutateAsync,
  mutateAsync: mockMutateAsync,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: undefined,
  reset: vi.fn(),
};

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationResult,
}));

vi.mock('@/app/hooks/use-convex-optimistic-mutation', () => ({
  useConvexOptimisticMutation: () => mockMutationResult,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    vendors: {
      mutations: {
        bulkCreateVendors: 'bulkCreateVendors',
        deleteVendor: 'deleteVendor',
        updateVendor: 'updateVendor',
      },
      queries: {
        listVendors: 'listVendors',
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
  it('returns a mutation result object from useConvexOptimisticMutation', () => {
    const result = useBulkCreateVendors();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });
});

describe('useDeleteVendor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object from useConvexOptimisticMutation', () => {
    const result = useDeleteVendor();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: deleteVendor } = useDeleteVendor();

    await deleteVendor({ vendorId: toId<'vendors'>('vendor-123') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ vendorId: 'vendor-123' });
  });

  it('propagates errors from mutation', async () => {
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

  it('returns a mutation result object from useConvexOptimisticMutation', () => {
    const result = useUpdateVendor();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
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

  it('calls mutation with only vendorId when no fields updated', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateVendor } = useUpdateVendor();

    await updateVendor({ vendorId: toId<'vendors'>('vendor-456') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ vendorId: 'vendor-456' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateVendor } = useUpdateVendor();

    await expect(
      updateVendor({ vendorId: toId<'vendors'>('vendor-789'), name: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
