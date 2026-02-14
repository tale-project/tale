import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutateAsync = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
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

  it('returns mutateAsync from useConvexMutation', () => {
    const removeMember = useRemoveMember();
    expect(removeMember).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const removeMember = useRemoveMember();

    await removeMember({ memberId: 'member-123' });

    expect(mockMutateAsync).toHaveBeenCalledWith({ memberId: 'member-123' });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const updateRole = useUpdateMemberRole();
    expect(updateRole).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const updateRole = useUpdateMemberRole();

    await updateRole({ memberId: 'member-123', role: 'admin' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      memberId: 'member-123',
      role: 'admin',
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
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

  it('returns mutateAsync from useConvexMutation', () => {
    const updateName = useUpdateMemberDisplayName();
    expect(updateName).toBe(mockMutateAsync);
  });

  it('calls mutateAsync with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(null);
    const updateName = useUpdateMemberDisplayName();

    await updateName({ memberId: 'member-123', displayName: 'New Name' });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      memberId: 'member-123',
      displayName: 'New Name',
    });
  });

  it('propagates errors from mutateAsync', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Update failed'));
    const updateName = useUpdateMemberDisplayName();

    await expect(
      updateName({ memberId: 'member-789', displayName: 'Fail' }),
    ).rejects.toThrow('Update failed');
  });
});
