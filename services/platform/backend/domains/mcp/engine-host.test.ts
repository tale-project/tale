import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { dispatch } from '../../../lib/engine/api/dispatch.ts';
import { pgAutomationStore } from '../automations/dispatch-store.ts';
import { dispatchCapabilityAs } from '../chat/capabilities.ts';
import type { McpCaller } from './caller.ts';
import { mcpDocs } from './docs.ts';
import { engineScope, mcpHost } from './engine-host.ts';

vi.mock('../../../lib/connectors/dispatcher.ts', () => ({
  loadConnectorCatalog: vi.fn(),
}));
vi.mock('../../../lib/engine/api/dispatch.ts', () => ({
  dispatch: vi.fn(async () => ({ automations: [] })),
}));
vi.mock('../automations/dispatch-store.ts', () => ({
  pgAutomationStore: vi.fn(() => ({ kind: 'store' })),
}));
vi.mock('../chat/capabilities.ts', () => ({
  dispatchCapabilityAs: vi.fn(async () => ({ capabilities: [] })),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked store and capability surface never touch the handle
const sql = {} as Sql;

function caller(apiKeyId?: string, clientName?: string): McpCaller {
  return {
    organizationId: 'org-acme',
    orgSlug: 'acme',
    userId: 'user-ada',
    role: 'developer',
    credential: {
      kind: 'api-key',
      ...(apiKeyId !== undefined ? { apiKeyId } : {}),
    },
    ...(clientName !== undefined ? { clientName } : {}),
  };
}

describe('engineScope', () => {
  it('records a keyed caller as the api-key door, with the key, and reads as the app would show them [MCP-R9]', () => {
    expect(engineScope(caller('key-laptop'))).toEqual({
      organizationId: 'org-acme',
      actor: 'api-key:user-ada',
      apiKeyId: 'key-laptop',
      via: 'mcp',
      visibleOnly: true,
    });
  });

  it('names no key the credential does not carry', () => {
    expect(engineScope(caller())).toEqual({
      organizationId: 'org-acme',
      actor: 'api-key:user-ada',
      via: 'mcp',
      visibleOnly: true,
    });
  });

  it('records the client a request names beside the door', () => {
    expect(engineScope(caller('key-laptop', 'Claude Code'))).toMatchObject({
      via: 'mcp',
      apiKeyId: 'key-laptop',
      clientName: 'Claude Code',
    });
  });
});

describe('mcpHost', () => {
  it('runs an engine method live against the caller’s organization store', async () => {
    const answer = await mcpHost(sql).engine(
      caller('key-laptop'),
      'start_run',
      {
        name: 'billing/dunning',
      },
    );

    expect(answer).toEqual({ automations: [] });
    expect(pgAutomationStore).toHaveBeenCalledWith(sql, {
      organizationId: 'org-acme',
      actor: 'api-key:user-ada',
      apiKeyId: 'key-laptop',
      via: 'mcp',
      visibleOnly: true,
    });
    expect(dispatch).toHaveBeenCalledWith(
      'start_run',
      { name: 'billing/dunning' },
      { store: { kind: 'store' }, allowLive: true, docs: mcpDocs },
    );
  });

  it('dispatches a capability method as the key holder', async () => {
    const answer = await mcpHost(sql).capability(
      caller('key-laptop'),
      'search_capabilities',
      { query: 'send an invoice' },
    );

    expect(answer).toEqual({ capabilities: [] });
    expect(dispatchCapabilityAs).toHaveBeenCalledWith(sql, {
      organizationId: 'org-acme',
      userId: 'user-ada',
      method: 'search_capabilities',
      params: { query: 'send an invoice' },
    });
  });
});
