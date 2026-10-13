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

/** A coding agent that signed in: a connection, never a key. */
function agent(clientName?: string): McpCaller {
  return {
    organizationId: 'org-acme',
    orgSlug: 'acme',
    userId: 'user-ada',
    role: 'developer',
    credential: {
      kind: 'agent',
      connectionId: 'conn-cursor',
      clientId: 'https://cursor.example.test/client.json',
      clientName: 'Cursor',
      scopes: new Set(['tale:mcp']),
    },
    ...(clientName !== undefined ? { clientName } : {}),
  };
}

describe('engineScope', () => {
  it('records a keyed caller as the api-key door, with the key, and reads as the app would show them [MCP-R9]', () => {
    expect(engineScope(caller('key-laptop'))).toEqual({
      organizationId: 'org-acme',
      origin: {
        actor: 'api-key:user-ada',
        apiKeyId: 'key-laptop',
        via: 'mcp',
      },
      visibleOnly: true,
    });
  });

  it('names no key the credential does not carry', () => {
    expect(engineScope(caller())).toEqual({
      organizationId: 'org-acme',
      origin: { actor: 'api-key:user-ada', via: 'mcp' },
      visibleOnly: true,
    });
  });

  it('records a coding agent as the same door with its connection and the app the person connected, and no key [MCP-R42]', () => {
    expect(engineScope(agent())).toEqual({
      organizationId: 'org-acme',
      origin: {
        actor: 'api-key:user-ada',
        via: 'mcp',
        agentConnectionId: 'conn-cursor',
        clientName: 'Cursor',
      },
      visibleOnly: true,
    });
    expect(engineScope(agent('Cursor 2.0'))).toMatchObject({
      origin: { agentConnectionId: 'conn-cursor', clientName: 'Cursor 2.0' },
    });
  });

  it('records the client a request names beside the door', () => {
    expect(engineScope(caller('key-laptop', 'Claude Code'))).toMatchObject({
      origin: {
        via: 'mcp',
        apiKeyId: 'key-laptop',
        clientName: 'Claude Code',
      },
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
      origin: {
        actor: 'api-key:user-ada',
        apiKeyId: 'key-laptop',
        via: 'mcp',
      },
      visibleOnly: true,
    });
    expect(dispatch).toHaveBeenCalledWith(
      'start_run',
      { name: 'billing/dunning' },
      { store: { kind: 'store' }, allowLive: true, docs: mcpDocs },
    );
  });

  it('dispatches a capability method as the key holder, with the key its spend is booked to', async () => {
    const answer = await mcpHost(sql).capability(
      caller('key-laptop'),
      'search_capabilities',
      { query: 'send an invoice' },
    );

    expect(answer).toEqual({ capabilities: [] });
    expect(dispatchCapabilityAs).toHaveBeenCalledWith(sql, {
      organizationId: 'org-acme',
      userId: 'user-ada',
      apiKeyId: 'key-laptop',
      method: 'search_capabilities',
      params: { query: 'send an invoice' },
    });
  });

  it('books nothing to a key for a coding agent’s capability call: a connection is not one [MCP-R42]', async () => {
    await mcpHost(sql).capability(agent(), 'search_capabilities', {});

    expect(dispatchCapabilityAs).toHaveBeenLastCalledWith(sql, {
      organizationId: 'org-acme',
      userId: 'user-ada',
      method: 'search_capabilities',
      params: {},
    });
  });

  it('names no key for a capability call the credential carries none for', async () => {
    await mcpHost(sql).capability(caller(), 'search_capabilities', {});

    expect(dispatchCapabilityAs).toHaveBeenLastCalledWith(sql, {
      organizationId: 'org-acme',
      userId: 'user-ada',
      method: 'search_capabilities',
      params: {},
    });
  });
});
