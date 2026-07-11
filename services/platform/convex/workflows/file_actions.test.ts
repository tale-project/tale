import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regression coverage for #2668: the task modal's actor directory calls
// `listWorkflows` before the organization id has resolved (falls back to
// `''`), and the server used to reject that with an uncaught ORG_NOT_FOUND
// ConvexError from `requireOrgMembershipById`. An empty id now short-circuits
// to `[]` before the auth gate ever runs.

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

// String sentinels — the empty-id path returns before any of these refs are
// touched; the non-empty path only needs the auth gate to have been called.
vi.mock('../_generated/api', () => ({
  internal: {
    workflows: {
      installations: { listInstalledSlugs: 'listInstalledSlugs' },
    },
  },
}));

// Replace the Convex function builders with identity functions so the loaded
// action is the plain `{ args, returns, handler }` config object.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// `file_actions.ts` (and its `lib/file_io` / `automations/file_utils`
// dependencies) touch real node fs/crypto modules at import time, which the
// edge-runtime test environment doesn't provide — stub them out. The
// empty-org-id path under test never calls any of these.
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  lstat: vi.fn(),
  open: vi.fn(),
  realpath: vi.fn(),
  rename: vi.fn(),
  constants: {},
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));
vi.mock('node:crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-hash'),
  })),
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

type Handler = { handler: (...args: unknown[]) => Promise<unknown> };

async function loadListWorkflows(): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- builders mocked to identity (see above)
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
  >;
  return mod.listWorkflows;
}

describe('listWorkflows — empty organization id (#2668)', () => {
  beforeEach(() => {
    mockRequireOrgMembershipById.mockReset();
  });

  it('returns [] without ever reaching the auth gate', async () => {
    const { handler } = await loadListWorkflows();

    const result = await handler({}, { organizationId: '' });

    expect(result).toEqual([]);
    expect(mockRequireOrgMembershipById).not.toHaveBeenCalled();
  });

  it('still gates a non-empty organization id', async () => {
    const { handler } = await loadListWorkflows();
    mockRequireOrgMembershipById.mockRejectedValue(new Error('ORG_NOT_FOUND'));

    await expect(handler({}, { organizationId: 'org_1' })).rejects.toThrow(
      'ORG_NOT_FOUND',
    );
    expect(mockRequireOrgMembershipById).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
    );
  });
});
