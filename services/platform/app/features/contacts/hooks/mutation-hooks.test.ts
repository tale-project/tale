import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        createContact: 'createContact',
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
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
} from './mutations';

describe('useCreateContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useCreateContact();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      success: true,
      contactId: 'contact-1',
    });
    const { mutateAsync: createContact } = useCreateContact();

    await createContact({
      organizationId: 'org-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1-555-0100',
      source: 'manual_import',
      locale: 'en',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1-555-0100',
      source: 'manual_import',
      locale: 'en',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Create failed'));
    const { mutateAsync: createContact } = useCreateContact();

    await expect(
      createContact({
        organizationId: 'org-1',
        email: 'jane@example.com',
        source: 'manual_import',
      }),
    ).rejects.toThrow('Create failed');
  });
});

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

    await deleteContact({ contactId: 'contact-123' });

    expect(mockMutateAsync).toHaveBeenCalledWith({ contactId: 'contact-123' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: deleteContact } = useDeleteContact();

    await expect(deleteContact({ contactId: 'contact-789' })).rejects.toThrow(
      'Delete failed',
    );
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
      contactId: 'contact-123',
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

    await updateContact({ contactId: 'contact-456' });

    expect(mockMutateAsync).toHaveBeenCalledWith({ contactId: 'contact-456' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateContact } = useUpdateContact();

    await expect(
      updateContact({
        contactId: 'contact-789',
        name: 'Fail',
      }),
    ).rejects.toThrow('Update failed');
  });
});
