// @vitest-environment node

/**
 * The skill download: a signed-in person gets the same `SKILL.md` the MCP
 * endpoint serves as `tale://docs/skill`, as a file to save; nobody gets it
 * without a session.
 */

import { describe, expect, it } from 'vitest';

import { buildTaleSkill } from '../../../lib/mcp/skill.ts';
import type { Auth } from '../../auth/auth.ts';
import { mcpDocs } from './docs.ts';
import { createMcpRoutes } from './routes.ts';

function doorFor(session: unknown) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {
    api: { getSession: () => Promise.resolve(session) },
  } as unknown as Auth;
  return createMcpRoutes({ auth });
}

function member(id: string) {
  return {
    user: { id, email: `${id}@example.test`, name: id },
    session: { id: `s-${id}` },
  };
}

describe('GET /api/app/mcp/skill', () => {
  it('downloads the skill as SKILL.md, the same file for every person [MCP-R25]', async () => {
    const ada = await doorFor(member('ada')).request('/skill');
    expect(ada.status).toBe(200);
    expect(ada.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(ada.headers.get('content-disposition')).toBe(
      'attachment; filename="SKILL.md"',
    );
    expect(ada.headers.get('cache-control')).toBe('no-store');
    const text = await ada.text();
    expect(text).toBe(buildTaleSkill());
    // The endpoint's resource serves the same bytes.
    expect(mcpDocs('skill')).toBe(text);
    const ben = await doorFor(member('ben')).request('/skill');
    expect(await ben.text()).toBe(text);
  });

  it('refuses a request without a session', async () => {
    const res = await doorFor(null).request('/skill');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
