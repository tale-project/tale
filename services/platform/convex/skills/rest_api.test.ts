/**
 * The skills REST surface.
 *
 * Same boundary as the agents surface — org slug from the resolved organization,
 * viewer from the key, `isOrgAdmin` derived from the role — plus the one shape
 * difference that matters: a skill's `description` and markdown `body` are
 * REQUIRED on a save, because a bundle without either is not a skill.
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
  restCtx as bareRestCtx,
  restRequest,
  testSession,
  TEST_ORG_SLUG,
  TEST_USER_ID,
  type RestCtxOptions,
  type StubRoutes,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import { deleteSkill, getSkill, listSkills, putSkill } from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LIST = 'skills/file_actions:listSkills';
const READ = 'skills/file_actions:readSkill';
const SAVE = 'skills/file_actions:saveSkill';
const DELETE = 'skills/file_actions:deleteSkill';
const VIEWER_CONTEXT = 'skills/viewer_context:getUserSkillViewerContext';

/**
 * Every skills handler resolves the caller's viewer context first. Answering
 * `null` (member not found in the mirror) exercises the documented fallback:
 * no teams, `isOrgAdmin` from the key holder's role.
 */
function restCtx(
  routes: StubRoutes = {},
  options: RestCtxOptions = {},
): ReturnType<typeof bareRestCtx> {
  return bareRestCtx({ [VIEWER_CONTEXT]: () => null, ...routes }, options);
}

/** The viewer shape the fallback path hands the file layer. */
function fallbackViewer(isOrgAdmin: boolean) {
  return {
    kind: 'user',
    userId: TEST_USER_ID,
    teamIds: [],
    isOrgAdmin,
  };
}

function skillDocument() {
  return {
    slug: 'invoice-audit',
    description: 'How we audit an invoice',
    body: '# Invoice audit\n',
    visibility: 'org',
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
    const response = await (listSkills as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/skills'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/skills', () => {
  it('lists with the caller the file layer expects', async () => {
    const { ctx, calls } = restCtx(
      { [LIST]: () => ({ skills: [skillDocument()], failures: [] }) },
      { role: 'owner' },
    );
    const response = await (listSkills as unknown as Handler)(
      ctx,
      restRequest('/api/v1/skills'),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, LIST)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      viewer: fallbackViewer(true),
    });
  });

  it('carries the mirror-resolved teams and admin bit when present', async () => {
    const { ctx, calls } = restCtx({
      [VIEWER_CONTEXT]: () => ({ teamIds: ['team_red'], isOrgAdmin: false }),
      [LIST]: () => ({ skills: [], failures: [] }),
    });
    await (listSkills as unknown as Handler)(
      ctx,
      restRequest('/api/v1/skills'),
    );
    expect(argsOf(calls, LIST)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      viewer: {
        kind: 'user',
        userId: TEST_USER_ID,
        teamIds: ['team_red'],
        isOrgAdmin: false,
      },
    });
  });
});

describe('GET /api/v1/skills/:slug', () => {
  it('answers the bundle, and 404 when the caller has none such', async () => {
    const { ctx } = restCtx({ [READ]: () => skillDocument() });
    expect(
      (
        await (getSkill as unknown as Handler)(
          ctx,
          restRequest('/api/v1/skills/invoice-audit'),
        )
      ).status,
    ).toBe(200);

    const { ctx: none } = restCtx({ [READ]: () => null });
    const missing = await (getSkill as unknown as Handler)(
      none,
      restRequest('/api/v1/skills/nope'),
    );
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toEqual({ error: 'Skill not found' });
  });
});

describe('PUT /api/v1/skills/:slug', () => {
  const put = putSkill as unknown as Handler;

  it('saves the bundle', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => skillDocument() });
    const response = await put(
      ctx,
      restRequest('/api/v1/skills/invoice-audit', {
        method: 'PUT',
        json: {
          description: 'How we audit an invoice',
          body: '# Invoice audit\n',
          visibility: 'org',
          labels: ['finance'],
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, SAVE)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      slug: 'invoice-audit',
      viewer: fallbackViewer(false),
      description: 'How we audit an invoice',
      body: '# Invoice audit\n',
      visibility: 'org',
      labels: ['finance'],
    });
  });

  it('passes team sharing through', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => skillDocument() });
    const response = await put(
      ctx,
      restRequest('/api/v1/skills/invoice-audit', {
        method: 'PUT',
        json: {
          description: 'How we audit an invoice',
          body: '# Invoice audit\n',
          visibility: 'team',
          teams: ['team_red', 'team_blue'],
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, SAVE)).toEqual({
      orgSlug: TEST_ORG_SLUG,
      slug: 'invoice-audit',
      viewer: fallbackViewer(false),
      description: 'How we audit an invoice',
      body: '# Invoice audit\n',
      visibility: 'team',
      teams: ['team_red', 'team_blue'],
    });
  });

  it('refuses an unknown visibility (400)', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => skillDocument() });
    const response = await put(
      ctx,
      restRequest('/api/v1/skills/invoice-audit', {
        method: 'PUT',
        json: { description: 'x', body: '# x', visibility: 'everyone' },
      }),
    );
    expect(response.status).toBe(400);
    expect(called(calls, SAVE)).toBe(false);
  });

  it('refuses a save with no description or no body (400)', async () => {
    const { ctx, calls } = restCtx({ [SAVE]: () => skillDocument() });
    for (const json of [
      {},
      { description: 'x' },
      { body: '# x' },
      { description: '', body: '# x' },
    ]) {
      const response = await put(
        ctx,
        restRequest('/api/v1/skills/invoice-audit', { method: 'PUT', json }),
      );
      expect(response.status).toBe(400);
    }
    expect(called(calls, SAVE)).toBe(false);
  });

  it('maps the ownership refusal to 403', async () => {
    const { ctx } = restCtx({
      [SAVE]: () => {
        throw new ConvexError({
          code: 'SKILL_FORBIDDEN',
          message: 'You cannot edit the skill "invoice-audit".',
        });
      },
    });
    const response = await put(
      ctx,
      restRequest('/api/v1/skills/invoice-audit', {
        method: 'PUT',
        json: { description: 'x', body: '# x' },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe('DELETE /api/v1/skills/:slug', () => {
  it('answers 204 when it deleted and 404 when there was nothing to delete', async () => {
    const { ctx } = restCtx({ [DELETE]: () => true });
    expect(
      (
        await (deleteSkill as unknown as Handler)(
          ctx,
          restRequest('/api/v1/skills/invoice-audit', { method: 'DELETE' }),
        )
      ).status,
    ).toBe(204);

    const { ctx: none } = restCtx({ [DELETE]: () => false });
    expect(
      (
        await (deleteSkill as unknown as Handler)(
          none,
          restRequest('/api/v1/skills/gone', { method: 'DELETE' }),
        )
      ).status,
    ).toBe(404);
  });
});
