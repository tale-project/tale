import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutateAsync = vi.fn();

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({
    mutate: mockMutateAsync,
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    team_members: {
      mutations: {
        addMember: 'addMember',
        removeMember: 'removeMember',
      },
      queries: {
        listByTeam: 'listByTeam',
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

  it('returns a mutation result object', () => {
    const result = useAddTeamMember();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: addTeamMember } = useAddTeamMember();

    await addTeamMember({
      teamId: 'team-123',
      userId: 'user-456',
      organizationId: 'org-789',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      teamId: 'team-123',
      userId: 'user-456',
      organizationId: 'org-789',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Add failed'));
    const { mutateAsync: addTeamMember } = useAddTeamMember();

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

  it('returns a mutation result object', () => {
    const result = useRemoveTeamMember();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });

  it('calls mutation with the correct args', async () => {
    mockMutateAsync.mockResolvedValueOnce(undefined);
    const { mutateAsync: removeTeamMember } = useRemoveTeamMember();

    await removeTeamMember({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      teamMemberId: 'tm-123',
      organizationId: 'org-456',
    });
  });

  it('propagates errors from mutation', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Remove failed'));
    const { mutateAsync: removeTeamMember } = useRemoveTeamMember();

    await expect(
      removeTeamMember({
        teamMemberId: 'tm-789',
        organizationId: 'org-456',
      }),
    ).rejects.toThrow('Remove failed');
  });
});

describe('useCreateTeamMember', () => {
  it('returns a mutation result object', () => {
    const result = useCreateTeamMember();
    expect(result).toHaveProperty('mutateAsync');
    expect(result).toHaveProperty('isPending');
  });
});
