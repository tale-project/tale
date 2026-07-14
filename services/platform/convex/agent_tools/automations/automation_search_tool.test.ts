import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    automations: {
      file_actions: {
        listCatalogAutomationsForAssistant:
          'mock-listCatalogAutomationsForAssistant',
        getAutomationManifestForAssistant:
          'mock-getAutomationManifestForAssistant',
      },
    },
  },
}));

// Mock createTool to expose the raw handler for testing.
vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

const CATALOG = [
  {
    slug: 'gmail/sync-emails',
    kind: 'automation' as const,
    name: 'Sync Gmail emails',
    description: 'Read, triage, and reply to Gmail.',
    hidden: true,
    labels: ['Email', 'Gmail'],
    requiredIntegrations: ['gmail'],
    workflows: [],
    agents: [],
    skills: [],
  },
  {
    slug: 'email-bundle',
    kind: 'bundle' as const,
    name: 'Email',
    description: 'Install every email provider automation at once.',
    hidden: false,
    labels: ['Email'],
    requiredIntegrations: [],
    workflows: [],
    agents: [],
    skills: [],
    members: ['gmail/sync-emails', 'outlook/sync-emails'],
  },
  {
    slug: 'issue-desk',
    kind: 'automation' as const,
    name: 'Resolve GitHub issues',
    description: 'Triage and reconcile GitHub issues.',
    hidden: false,
    labels: ['GitHub'],
    requiredIntegrations: ['github'],
    workflows: ['issue-desk/desk-process'],
    agents: ['desk-implementer'],
    skills: [],
  },
];

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    runAction: vi.fn(),
    ...overrides,
  };
}

async function getHandler() {
  const { automationSearchTool } = await import('./automation_search_tool');
  return (automationSearchTool.tool as { _handler: Function })._handler;
}

describe('automation_search tool handler', () => {
  it('list: returns every catalog entry, including hidden and bundles', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(CATALOG),
    });

    const result = await handler(ctx, { operation: 'list' });

    expect(result.operation).toBe('list');
    expect(result.total).toBe(3);
    expect(
      result.automations.map((a: { slug: string }) => a.slug).sort(),
    ).toEqual(['email-bundle', 'gmail/sync-emails', 'issue-desk'].sort());
    // Hidden bundle members are visible to the assistant.
    expect(
      result.automations.find(
        (a: { slug: string }) => a.slug === 'gmail/sync-emails',
      ),
    ).toMatchObject({ hidden: true });
  });

  it('list: filters by kind', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(CATALOG),
    });

    const result = await handler(ctx, { operation: 'list', kind: 'bundle' });

    expect(result.automations).toEqual([
      expect.objectContaining({ slug: 'email-bundle' }),
    ]);
  });

  it('list: filters by a case-insensitive query over name/description/labels', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(CATALOG),
    });

    const byLabel = await handler(ctx, { operation: 'list', query: 'github' });
    expect(byLabel.automations).toEqual([
      expect.objectContaining({ slug: 'issue-desk' }),
    ]);

    const byDescription = await handler(ctx, {
      operation: 'list',
      query: 'reply to gmail',
    });
    expect(byDescription.automations).toEqual([
      expect.objectContaining({ slug: 'gmail/sync-emails' }),
    ]);
  });

  it('get: returns the full parsed manifest for a slug', async () => {
    const handler = await getHandler();
    const manifest = { name: 'Sync Gmail emails', hidden: true };
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(manifest),
    });

    const result = await handler(ctx, {
      operation: 'get',
      slug: 'gmail/sync-emails',
    });

    expect(result).toEqual({
      operation: 'get',
      slug: 'gmail/sync-emails',
      manifest,
    });
  });

  it('get: reports a not-found slug without throwing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ runAction: vi.fn().mockResolvedValue(null) });

    const result = await handler(ctx, {
      operation: 'get',
      slug: 'does-not-exist',
    });

    expect(result.manifest).toBeNull();
    expect(result.error).toContain('does-not-exist');
  });

  it('throws when organizationId is missing from the tool context', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(handler(ctx, { operation: 'list' })).rejects.toBeInstanceOf(
      ConvexError,
    );
  });
});
