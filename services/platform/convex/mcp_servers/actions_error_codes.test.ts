import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { api, internal } from '../_generated/api';
import schema from '../schema';

/**
 * #2015 regression: the public MCP-server actions must reject with a structured
 * `ConvexError({ code })` so the Integrations/MCP settings panel can surface a
 * specific message instead of the generic "Server Error" a raw `Error` becomes
 * in prod:
 *   - `testConnection`  → UNAUTHENTICATED (no identity), NOT_FOUND (missing id)
 *   - `executeMcpTool`  → NOT_FOUND (missing id), SERVER_NOT_ACTIVE (inactive)
 *
 * `client_factory` is mocked: it pulls in the MCP SDK (node:child_process), and
 * none of these error paths reach `discoverTools`/`executeTool` anyway — every
 * throw happens before the connection is opened.
 */

vi.mock('./client_factory', () => ({
  discoverTools: vi.fn(),
  executeTool: vi.fn(),
}));

const TEST_DIR_FROM_CONVEX_ROOT = 'mcp_servers';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const IDENTITY = {
  subject: 'user_mcp',
  email: 'mcp@example.com',
  name: 'MCP Tester',
};

function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = (err as { data: unknown }).data;
  // convex-test can double-encode the payload (a JSON string of a JSON string).
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = (data as { code: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return codeOf(err);
  }
  return undefined;
}

function newConvexTest() {
  return convexTest(schema, modules);
}

/** Insert an MCP server, then delete it: a well-formed id that resolves null. */
async function danglingServerId(t: ReturnType<typeof newConvexTest>) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert('mcpServers', {
      organizationId: 'org_1',
      name: 'gone',
      displayName: 'Gone',
      transportType: 'streamable_http',
      authType: 'none',
      status: 'inactive',
    });
    await ctx.db.delete(id);
    return id;
  });
}

describe('mcp_servers action error codes (#2015)', () => {
  it('testConnection throws UNAUTHENTICATED when no identity is present', async () => {
    const t = newConvexTest();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('mcpServers', {
        organizationId: 'org_1',
        name: 'srv',
        displayName: 'Srv',
        transportType: 'streamable_http',
        authType: 'none',
        status: 'inactive',
      }),
    );
    const code = await catchCode(() =>
      t.action(api.mcp_servers.actions.testConnection, { id }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('testConnection throws NOT_FOUND when the server does not exist', async () => {
    const t = newConvexTest();
    const id = await danglingServerId(t);
    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .action(api.mcp_servers.actions.testConnection, { id }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('executeMcpTool throws NOT_FOUND when the server does not exist', async () => {
    const t = newConvexTest();
    const serverId = await danglingServerId(t);
    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .action(internal.mcp_servers.actions.executeMcpTool, {
          serverId,
          toolName: 'doThing',
        }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('executeMcpTool throws SERVER_NOT_ACTIVE when the server is not active', async () => {
    const t = newConvexTest();
    const serverId = await t.run(async (ctx) =>
      ctx.db.insert('mcpServers', {
        organizationId: 'org_1',
        name: 'inactive-srv',
        displayName: 'Inactive Srv',
        transportType: 'streamable_http',
        authType: 'none',
        status: 'inactive',
      }),
    );
    const code = await catchCode(() =>
      t
        .withIdentity(IDENTITY)
        .action(internal.mcp_servers.actions.executeMcpTool, {
          serverId,
          toolName: 'doThing',
        }),
    );
    expect(code).toBe('SERVER_NOT_ACTIVE');
  });
});
