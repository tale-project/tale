import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    integrations: {
      credential_queries: {
        listInternal: 'mock-listInternal',
      },
    },
  },
}));

// Mock createTool to expose the raw handler for testing
vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    runQuery: vi.fn(),
    ...overrides,
  };
}

async function getHandler() {
  const { workflowSyntaxTool } = await import('../workflow_syntax_tool');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
  return (workflowSyntaxTool.tool as { _handler: Function })._handler;
}

describe('workflow_syntax tool handler', () => {
  it('includes integration listing when category is action', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue([
        {
          slug: 'shopify',
          status: 'active',
        },
        {
          slug: 'my_db',
          status: 'active',
        },
      ]),
    });

    const result = await handler(ctx, { category: 'action' });

    expect(result.syntax).toContain('### Available Integrations');
    expect(result.syntax).toContain('integration_introspect');
    expect(result.syntax).toContain('shopify (rest_api, active): shopify');
    expect(result.syntax).toContain('my_db (rest_api, active): my_db');
  });

  it('shows "no integrations" message when org has none', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue([]),
    });

    const result = await handler(ctx, { category: 'action' });

    expect(result.syntax).toContain('No integrations configured');
  });

  it('does not include integrations for non-action categories', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx();

    const result = await handler(ctx, { category: 'llm' });

    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(result.syntax).not.toContain('Available Integrations');
  });

  it('includes integrations when no category specified (all syntax)', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue([
        {
          slug: 'erp',
          status: 'active',
        },
      ]),
    });

    const result = await handler(ctx, {});

    expect(result.syntax).toContain('### Available Integrations');
    expect(result.syntax).toContain('erp (rest_api, active): erp');
  });

  it('handles missing organizationId gracefully', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, { category: 'action' });

    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(result.syntax).not.toContain('Available Integrations');
  });
});
