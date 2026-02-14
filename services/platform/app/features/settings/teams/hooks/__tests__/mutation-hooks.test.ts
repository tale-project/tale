import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutationFn = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => mockMutationFn,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    team_members: {
      mutations: {
        addMember: 'addMember',
        removeMember: 'removeMember',
      },
    },
  },
}));

import {
  useAddTeamMember,
  useCreateTeamMember,
  useRemoveTeamMember,
} from '../mutations';

describe('useAddTeamMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const addTeamMember = useAddTeamMember();
    expect(addTeamMember).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const addTeamMember = useAddTeamMember();

    await addTeamMember({
      teamId: 'team-123',
      userId: 'user-456',
      organizationId: 'org-789',
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      teamId: 'team-123',
      userId: 'user-456',
      organizationId: 'org-789',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Add failed'));
    const addTeamMember = useAddTeamMember();

    await expect(
      addTeamMember({
        teamId: 'team-123',
        userId: 'user-456',
        organizationId: 'org-789',
      }),
    ).rejects.toThrow('Add failed');
  });
});

describe('useRemoveTeamMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the mutation function from useConvexMutation', () => {
    const removeTeamMember = useRemoveTeamMember();
    expect(removeTeamMember).toBe(mockMutationFn);
  });

  it('calls mutation with the correct args', async () => {
    mockMutationFn.mockResolvedValueOnce(undefined);
    const removeTeamMember = useRemoveTeamMember();

    await removeTeamMember({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });

    expect(mockMutationFn).toHaveBeenCalledWith({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutationFn.mockRejectedValueOnce(new Error('Remove failed'));
    const removeTeamMember = useRemoveTeamMember();

    await expect(
      removeTeamMember({
        teamMemberId: 'tm-789',
        organizationId: 'org-456',
      }),
    ).rejects.toThrow('Remove failed');
  });
});

describe('useCreateTeamMember', () => {
  it('returns the mutation function from useConvexMutation', () => {
    const result = useCreateTeamMember();
    expect(result).toBe(mockMutationFn);
  });
});
