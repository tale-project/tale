/**
 * The agents REST surface.
 *
 * The contract worth pinning here is the CALLER the config file layer is handed:
 * the org slug comes from the resolved organization (never the request), the
 * viewer is the key's user, and `isOrgAdmin` is derived from the member's role
 * through the same capability the session path uses — an `admin` key may curate
 * an org agent it does not own, a `member` key may not. Plus the tri-state
 * binding lists, where `null` means "remove the narrowing" and absent means
 * "leave it alone".
 */

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import {
  anonymousRequest,
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_SLUG,
  TEST_USER_ID,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import { deleteAgent, getAgent, listAgents, putAgent } from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LIST = 'agents/file_actions:listAgents';
const READ = 'agents/file_actions:readAgent';
const SAVE = 'agents/file_actions:saveAgent';
const DELETE = 'agents/file_actions:deleteAgent';

function agentDocument() {
  return {
    slug: 'support-triage',
    displayName: 'Support triage',
    visibility: 'org',
    knowledge: 'documents',
    canEdit: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (listAgents as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/agents'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/agents', () => {
  it('lists with the org slug from the key and the derived admin flag', async () => {
    const { ctx, calls } = restCtx(
      { [LIST]: () => ({ agents: [agentDocument()], failures: [] }) },
      { role: 'admin' },
    );
    const response = await (listAgents as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents'),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, LIST)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      viewerUserId: TEST_USER_ID,
      isOrgAdmin: true,
    });
  });

  it('does not claim org-admin for a plain member', async () => {
    const { ctx, calls } = restCtx(
      { [LIST]: () => ({ agents: [], failures: [] }) },
      { role: 'member' },
    );
    await (listAgents as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents'),
    );
    expect(argsOf(calls, LIST)?.isOrgAdmin).toBe(false);
  });

  it('refuses a key whose membership has been revoked (403)', async () => {
    const { ctx, calls } = restCtx(
      { [LIST]: () => ({ agents: [], failures: [] }) },
      { role: null },
    );
    const response = await (listAgents as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents'),
    );
    expect(response.status).toBe(403);
    expect(called(calls, LIST)).toBe(false);
  });
});

describe('GET /api/v1/agents/:slug', () => {
  it('answers the document, and 404 when the caller has none such', async () => {
    const { ctx, calls } = restCtx({ [READ]: () => agentDocument() });
    const found = await (getAgent as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents/support-triage'),
    );
    expect(found.status).toBe(200);
    expect(argsOf(calls, READ)?.slug).toBe('support-triage');

    const { ctx: none } = restCtx({ [READ]: () => null });
    const missing = await (getAgent as unknown as Handler)(
      none,
      restRequest('/api/v1/agents/nope'),
    );
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toEqual({ error: 'Agent not found' });
  });

  it('maps an invalid slug refusal to 400', async () => {
    const { ctx } = restCtx({
      [READ]: () => {
        throw new ConvexError({
          code: 'INVALID_AGENT_SLUG',
          message: '"Bad Slug" is not a valid agent slug',
        });
      },
    });
    const response = await (getAgent as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents/Bad%20Slug'),
    );
    expect(response.status).toBe(400);
  });
});

describe('PUT /api/v1/agents/:slug', () => {
  const put = putAgent as unknown as Handler;

  it('saves the fields it was given and nothing else', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => agentDocument() });
    const response = await put(
      ctx,
      restRequest('/api/v1/agents/support-triage', {
        method: 'PUT',
        json: {
          displayName: 'Support triage',
          description: 'Sorts inbound tickets',
          visibility: 'org',
          knowledge: 'documents',
          skills: ['pdf'],
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, SAVE)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      slug: 'support-triage',
      viewerUserId: TEST_USER_ID,
      isOrgAdmin: false,
      displayName: 'Support triage',
      description: 'Sorts inbound tickets',
      visibility: 'org',
      knowledge: 'documents',
      skills: ['pdf'],
    });
  });

  it('carries a null binding list through as null, not as absent', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => agentDocument() });
    await put(
      ctx,
      restRequest('/api/v1/agents/support-triage', {
        method: 'PUT',
        json: { displayName: 'Support triage', tools: null, skills: [] },
      }),
    );
    const args = argsOf(calls, SAVE);
    expect(args?.tools).toBeNull();
    expect(args?.skills).toEqual([]);
  });

  it('refuses a body with no displayName, a bad visibility or a bad list (400)', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => agentDocument() });
    for (const json of [
      {},
      { displayName: '' },
      { displayName: 'A', visibility: 'public' },
      { displayName: 'A', knowledge: 'everything' },
      { displayName: 'A', labels: [1, 2] },
    ]) {
      const response = await put(
        ctx,
        restRequest('/api/v1/agents/support-triage', { method: 'PUT', json }),
      );
      expect(response.status).toBe(400);
    }
    expect(called(calls, SAVE)).toBe(false);
  });

  it('maps the file layer ownership refusal to 403', async () => {
    const { ctx } = restCtx({
      [SAVE]: () => {
        throw new ConvexError({
          code: 'AGENT_FORBIDDEN',
          message: 'You cannot edit the agent "support-triage".',
        });
      },
    });
    const response = await put(
      ctx,
      restRequest('/api/v1/agents/support-triage', {
        method: 'PUT',
        json: { displayName: 'Support triage' },
      }),
    );
    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toEqual({
      error: 'You cannot edit the agent "support-triage".',
    });
  });
});

describe('DELETE /api/v1/agents/:slug', () => {
  it('answers 204 when it deleted and 404 when there was nothing to delete', async () => {
    const { ctx } = restCtx({ [DELETE]: () => true });
    const deleted = await (deleteAgent as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents/support-triage', { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(204);

    const { ctx: none } = restCtx({ [DELETE]: () => false });
    const missing = await (deleteAgent as unknown as Handler)(
      none,
      restRequest('/api/v1/agents/gone', { method: 'DELETE' }),
    );
    expect(missing.status).toBe(404);
  });

  it('rejects a sub-path rather than guessing what it meant', async () => {
    const { ctx } = restCtx({ [DELETE]: () => true });
    const response = await (deleteAgent as unknown as Handler)(
      ctx,
      restRequest('/api/v1/agents/support-triage/history', {
        method: 'DELETE',
      }),
    );
    expect(response.status).toBe(404);
  });
});
