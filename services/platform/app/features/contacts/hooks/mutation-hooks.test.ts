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

vi.mock('@/convex/_generated/api', () => ({
  api: {
    contacts: {
      mutations: {
        bulkCreateContacts: 'bulkCreateContacts',
        deleteContact: 'deleteContact',
        updateContact: 'updateContact',
      },
      queries: {
        listContacts: 'listContacts',
      },
    },
  },
}));

import {
  useBulkCreateContacts,
  useDeleteContact,
  useUpdateContact,
} from './mutations';

describe('useBulkCreateContacts', () => {
  it('returns a mutation result object', () => {
    const result = useBulkCreateContacts();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });
});

describe('useDeleteContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useDeleteContact();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: deleteContact } = useDeleteContact();

    await deleteContact({ contactId: toId<'contacts'>('contact-123') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ contactId: 'contact-123' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: deleteContact } = useDeleteContact();

    await expect(
      deleteContact({ contactId: toId<'contacts'>('contact-789') }),
    ).rejects.toThrow('Delete failed');
  });
});

describe('useUpdateContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useUpdateContact();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateContact } = useUpdateContact();

    await updateContact({
      contactId: toId<'contacts'>('contact-123'),
      name: 'Updated Name',
      email: 'new@example.com',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      contactId: 'contact-123',
      name: 'Updated Name',
      email: 'new@example.com',
    });
  });

  it('calls mutation with only contactId when no fields updated', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: updateContact } = useUpdateContact();

    await updateContact({ contactId: toId<'contacts'>('contact-456') });

    expect(mockMutateAsync).toHaveBeenCalledWith({ contactId: 'contact-456' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateContact } = useUpdateContact();

    await expect(
      updateContact({
        contactId: toId<'contacts'>('contact-789'),
        name: 'Fail',
      }),
    ).rejects.toThrow('Update failed');
  });
});
