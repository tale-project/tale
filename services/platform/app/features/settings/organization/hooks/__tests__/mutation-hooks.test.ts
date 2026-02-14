import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
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
    },
  },
}));

import {
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateMemberDisplayName,
} from '../mutations';

describe('useRemoveMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const removeMember = useRemoveMember();
    expect(removeMember).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const removeMember = useRemoveMember();

    await removeMember({ memberId: 'member-123' });

    expect(mockMutationFn).toHaveBeenCalledWith({ memberId: 'member-123' });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Delete failed'));
    const removeMember = useRemoveMember();

    await expect(removeMember({ memberId: 'member-789' })).rejects.toThrow(
      'Delete failed',
    );
  });
});

describe('useUpdateMemberRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const updateRole = useUpdateMemberRole();
    expect(updateRole).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const updateRole = useUpdateMemberRole();

    await updateRole({ memberId: 'member-123', role: 'admin' });

    expect(mockMutationFn).toHaveBeenCalledWith({
      memberId: 'member-123',
      role: 'admin',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Update failed'));
    const updateRole = useUpdateMemberRole();

    await expect(
      updateRole({ memberId: 'member-789', role: 'admin' }),
    ).rejects.toThrow('Update failed');
  });
});

describe('useUpdateMemberDisplayName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const updateName = useUpdateMemberDisplayName();
    expect(updateName).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(null);
    const updateName = useUpdateMemberDisplayName();

    await updateName({ memberId: 'member-123', displayName: 'New Name' });

    expect(mockMutationFn).toHaveBeenCalledWith({
      memberId: 'member-123',
      displayName: 'New Name',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Update failed'));
    const updateName = useUpdateMemberDisplayName();

    await expect(
      updateName({ memberId: 'member-789', displayName: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
