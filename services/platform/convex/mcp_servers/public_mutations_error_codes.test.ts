import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

/**
 * #2015 regression: the public MCP-server management actions
 * (`create`, `update`, `remove`, `updateStatus`) must reject an unauthenticated
 * caller with a structured `ConvexError({ code: 'UNAUTHENTICATED' })` so the
 * Integrations/MCP settings panel can redirect to login or show a specific
 * error. A raw `Error` is redacted to "Server Error" in prod, leaving the
 * client with nothing to act on.
 *
 * End-to-end through the real action: no identity is supplied via
 * `withIdentity`, so each handler throws before touching the database.
 */

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

describe('mcp_servers public management action error codes (#2015)', () => {
  it('create throws UNAUTHENTICATED when no identity is present', async () => {
    const t = newConvexTest();
    const code = await catchCode(() =>
      t.action(api.mcp_servers.public_mutations.create, {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        transportType: 'streamable_http',
        authType: 'none',
      }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('update throws UNAUTHENTICATED when no identity is present', async () => {
    const t = newConvexTest();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('mcpServers', {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        transportType: 'streamable_http',
        authType: 'none',
        status: 'inactive',
      }),
    );
    const code = await catchCode(() =>
      t.action(api.mcp_servers.public_mutations.update, {
        id,
        displayName: 'Renamed',
      }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('remove throws UNAUTHENTICATED when no identity is present', async () => {
    const t = newConvexTest();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('mcpServers', {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        transportType: 'streamable_http',
        authType: 'none',
        status: 'inactive',
      }),
    );
    const code = await catchCode(() =>
      t.action(api.mcp_servers.public_mutations.remove, { id }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('updateStatus throws UNAUTHENTICATED when no identity is present', async () => {
    const t = newConvexTest();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('mcpServers', {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        transportType: 'streamable_http',
        authType: 'none',
        status: 'inactive',
      }),
    );
    const code = await catchCode(() =>
      t.action(api.mcp_servers.public_mutations.updateStatus, {
        id,
        status: 'active',
      }),
    );
    expect(code).toBe('UNAUTHENTICATED');
  });
});
