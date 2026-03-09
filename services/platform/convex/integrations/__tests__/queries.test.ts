import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Doc } from '../../_generated/dataModel';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        findOne: 'betterAuth:adapter:findOne',
      },
    },
  },
}));

vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
}));

vi.mock('../../lib/rls/errors', () => {
  class RLSError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
      this.name = 'RLSError';
    }
  }
  return {
    UnauthorizedError: class extends RLSError {
      constructor() {
        super('Not authorized to access this resource', 'UNAUTHORIZED');
      }
    },
  };
});

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
  };
});

vi.mock('../validators', () => ({
  integrationDocValidator: 'integrationDocValidator',
}));

vi.mock('../get_integration', () => ({
  getIntegration: vi.fn(),
}));

vi.mock('../get_integration_by_name', () => ({
  getIntegrationByName: vi.fn(),
}));

vi.mock('../list_integrations', () => ({
  listIntegrations: vi.fn(),
}));

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const { getAuthUserIdentity, getOrganizationMember } =
  await import('../../lib/rls');
const { UnauthorizedError } = await import('../../lib/rls/errors');
const { getIntegration } = await import('../get_integration');
const { getIntegrationByName } = await import('../get_integration_by_name');
const { listIntegrations } = await import('../list_integrations');

const mockedGetAuthUser = vi.mocked(getAuthUserIdentity);
const mockedGetOrgMember = vi.mocked(getOrganizationMember);
const mockedGetIntegration = vi.mocked(getIntegration);
const mockedGetIntegrationByName = vi.mocked(getIntegrationByName);
const mockedListIntegrations = vi.mocked(listIntegrations);

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    storage: { getUrl: vi.fn() },
    db: {},
    auth: {},
  };
}

function makeIntegrationDoc(
  overrides: Record<string, unknown> = {},
): Doc<'integrations'> {
  return {
    _id: 'int_1',
    _creationTime: 1000,
    organizationId: 'org_1',
    name: 'Test Integration',
    type: 'rest_api',
    iconStorageId: undefined,
    ...overrides,
  } as unknown as Doc<'integrations'>;
}

describe('get handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const { get } = await import('../queries');
    const handler = (get as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { integrationId: 'int_1' });

    expect(result).toBeNull();
  });

  it('returns null when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetIntegration.mockResolvedValue(makeIntegrationDoc());
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();
    const { get } = await import('../queries');
    const handler = (get as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { integrationId: 'int_1' });

    expect(result).toBeNull();
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetIntegration.mockResolvedValue(makeIntegrationDoc());
    mockedGetOrgMember.mockRejectedValue(new Error('DB failure'));
    const ctx = createMockCtx();
    const { get } = await import('../queries');
    const handler = (get as unknown as { handler: Function }).handler;

    await expect(handler(ctx, { integrationId: 'int_1' })).rejects.toThrow(
      'DB failure',
    );
  });

  it('returns integration with icon URL on success', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const doc = makeIntegrationDoc({ iconStorageId: 'storage_icon' });
    mockedGetIntegration.mockResolvedValue(doc);
    mockedGetOrgMember.mockResolvedValue({} as never);
    const ctx = createMockCtx();
    ctx.storage.getUrl.mockResolvedValue('https://storage.example.com/icon');
    const { get } = await import('../queries');
    const handler = (get as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { integrationId: 'int_1' });

    expect(result).toMatchObject({
      _id: 'int_1',
      iconUrl: 'https://storage.example.com/icon',
    });
  });

  it('returns null iconUrl when storage fetch fails', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    const doc = makeIntegrationDoc({ iconStorageId: 'storage_icon' });
    mockedGetIntegration.mockResolvedValue(doc);
    mockedGetOrgMember.mockResolvedValue({} as never);
    const ctx = createMockCtx();
    ctx.storage.getUrl.mockRejectedValue(new Error('Storage unavailable'));
    const { get } = await import('../queries');
    const handler = (get as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { integrationId: 'int_1' });

    expect(result).toMatchObject({
      _id: 'int_1',
      iconUrl: null,
    });
  });
});

describe('getByName handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const { getByName } = await import('../queries');
    const handler = (getByName as unknown as { handler: Function }).handler;

    const result = await handler(ctx, {
      organizationId: 'org_1',
      name: 'My Integration',
    });

    expect(result).toBeNull();
  });

  it('returns null when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();
    const { getByName } = await import('../queries');
    const handler = (getByName as unknown as { handler: Function }).handler;

    const result = await handler(ctx, {
      organizationId: 'org_1',
      name: 'My Integration',
    });

    expect(result).toBeNull();
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new Error('DB failure'));
    const ctx = createMockCtx();
    const { getByName } = await import('../queries');
    const handler = (getByName as unknown as { handler: Function }).handler;

    await expect(
      handler(ctx, { organizationId: 'org_1', name: 'My Integration' }),
    ).rejects.toThrow('DB failure');
  });

  it('returns null when integration not found', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({} as never);
    mockedGetIntegrationByName.mockResolvedValue(null);
    const ctx = createMockCtx();
    const { getByName } = await import('../queries');
    const handler = (getByName as unknown as { handler: Function }).handler;

    const result = await handler(ctx, {
      organizationId: 'org_1',
      name: 'Nonexistent',
    });

    expect(result).toBeNull();
  });

  it('returns integration with icon URL on success', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({} as never);
    const doc = makeIntegrationDoc({ iconStorageId: 'storage_icon' });
    mockedGetIntegrationByName.mockResolvedValue(doc);
    const ctx = createMockCtx();
    ctx.storage.getUrl.mockResolvedValue('https://storage.example.com/icon');
    const { getByName } = await import('../queries');
    const handler = (getByName as unknown as { handler: Function }).handler;

    const result = await handler(ctx, {
      organizationId: 'org_1',
      name: 'Test Integration',
    });

    expect(result).toMatchObject({
      _id: 'int_1',
      iconUrl: 'https://storage.example.com/icon',
    });
  });
});

describe('list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when not authenticated', async () => {
    mockedGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const { list } = await import('../queries');
    const handler = (list as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual([]);
  });

  it('returns empty array when unauthorized', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new UnauthorizedError());
    const ctx = createMockCtx();
    const { list } = await import('../queries');
    const handler = (list as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toEqual([]);
  });

  it('re-throws non-authorization errors from getOrganizationMember', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockRejectedValue(new Error('System error'));
    const ctx = createMockCtx();
    const { list } = await import('../queries');
    const handler = (list as unknown as { handler: Function }).handler;

    await expect(handler(ctx, { organizationId: 'org_1' })).rejects.toThrow(
      'System error',
    );
  });

  it('returns integrations with icon URLs', async () => {
    mockedGetAuthUser.mockResolvedValue({ userId: 'user_1' });
    mockedGetOrgMember.mockResolvedValue({} as never);
    const docs = [
      makeIntegrationDoc({ _id: 'int_1', iconStorageId: 'sid_1' }),
      makeIntegrationDoc({ _id: 'int_2' }),
    ];
    mockedListIntegrations.mockResolvedValue(docs);
    const ctx = createMockCtx();
    ctx.storage.getUrl.mockResolvedValueOnce('https://storage.example.com/i1');
    const { list } = await import('../queries');
    const handler = (list as unknown as { handler: Function }).handler;

    const result = await handler(ctx, { organizationId: 'org_1' });

    expect(result).toHaveLength(2);
    expect(result[0].iconUrl).toBe('https://storage.example.com/i1');
    expect(result[1].iconUrl).toBeNull();
  });
});
