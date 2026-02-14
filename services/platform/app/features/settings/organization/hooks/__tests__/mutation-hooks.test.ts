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
    users: {
      mutations: {
        setMemberPassword: 'setMemberPassword',
        createMember: 'createMember',
      },
    },
    members: {
      mutations: {
        removeMember: 'removeMember',
        updateMemberRole: 'updateMemberRole',
        updateMemberDisplayName: 'updateMemberDisplayName',
      },
      queries: {
        listByOrganization: 'listByOrganization',
      },
    },
  },
}));

import {
  useCreateMember,
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateMemberDisplayName,
} from '../mutations';

describe('useCreateMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useCreateMember();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      userId: 'user-1',
      memberId: 'member-1',
      isExistingUser: false,
    });
    const { mutateAsync: createMember } = useCreateMember();

    await createMember({
      organizationId: 'org-123',
      email: 'test@example.com',
      role: 'member',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-123',
      email: 'test@example.com',
      role: 'member',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Create failed'));
    const { mutateAsync: createMember } = useCreateMember();

    await expect(
      createMember({
        organizationId: 'org-123',
        email: 'test@example.com',
      }),
    ).rejects.toThrow('Create failed');
  });
});

describe('useRemoveMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useRemoveMember();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: removeMember } = useRemoveMember();

    await removeMember({ memberId: 'member-123' });

    expect(mockMutateAsync).toHaveBeenCalledWith({ memberId: 'member-123' });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const { mutateAsync: removeMember } = useRemoveMember();

    await expect(removeMember({ memberId: 'member-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateMemberRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useUpdateMemberRole();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: updateRole } = useUpdateMemberRole();

    await updateRole({ memberId: 'member-123', role: 'admin' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      memberId: 'member-123',
      role: 'admin',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateRole } = useUpdateMemberRole();

    await expect(
      updateRole({ memberId: 'member-789', role: 'admin' }),
    ).rejects.toThrow('Update failed');
  });
});

describe('useUpdateMemberDisplayName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a mutation result object', () => {
    const result = useUpdateMemberDisplayName();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const { mutateAsync: updateName } = useUpdateMemberDisplayName();

    await updateName({ memberId: 'member-123', displayName: 'New Name' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      memberId: 'member-123',
      displayName: 'New Name',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const { mutateAsync: updateName } = useUpdateMemberDisplayName();

    await expect(
      updateName({ memberId: 'member-789', displayName: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
