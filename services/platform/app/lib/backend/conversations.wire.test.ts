// @vitest-environment jsdom
/**
 * The assignment adapters against the doors they call: each request the
 * adapter builds goes through the REAL conversation routes, behind the app
 * door's JSON reader as `/api/app/*` is in production — only the session,
 * the membership and the service below the door are stubbed.
 *
 * The Inbox's **Unassign** and **Remove team** send `null`, and the doors
 * refused it, so an admin could not clear an assignment at all (#3732). The
 * doors now take `null` as the clear; anything that is neither an id nor
 * `null` is a missing argument the adapter refuses before sending, never a
 * clear (#3708).
 */
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '@/backend/auth/org';

const { assignConversation, assignConversationTeam } = vi.hoisted(() => ({
  assignConversation: vi.fn(),
  assignConversationTeam: vi.fn(),
}));

vi.mock('@/backend/domains/conversations/service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/backend/domains/conversations/service')
  >()),
  assignConversation,
  assignConversationTeam,
}));
// The doors' other lanes (sending, the AI rewrite) are not on this path;
// stubbed, so their connector runtime never loads under jsdom.
vi.mock('@/backend/domains/conversations/send', () => ({}));
vi.mock('@/backend/domains/conversations/improve', () => ({
  IMPROVE_MAX_INPUT_CHARS: 1,
  IMPROVE_MAX_INSTRUCTION_CHARS: 1,
}));
vi.mock('@/backend/auth/session', () => ({
  requireSession: () => async (c: Context<OrgEnv>, next: Next) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the doors read the user's id and email only
    c.set('sessionBundle', {
      user: { id: 'admin-1', email: 'admin@example.test' },
    } as never);
    await next();
  },
}));
vi.mock('@/backend/auth/org', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/backend/auth/org')>()),
  requireOrgMember: () => async (c: Context<OrgEnv>, next: Next) => {
    c.set('orgId', 'org1');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the doors read the role only
    c.set('orgMember', { role: 'admin' } as never);
    await next();
  },
}));

import { createConversationRoutes } from '@/backend/domains/conversations/routes';
import { appJsonBody } from '@/backend/lib/app-json-body';

import { conversationWriteAdapters } from './conversations';

const ctx = { organizationId: 'org1' };

function appDoor(): Hono {
  const app = new Hono();
  app.use('/api/app/*', appJsonBody());
  app.route(
    '/api/app/conversations',
    createConversationRoutes({ sql: {} as never, auth: {} as never }),
  );
  return app;
}

/** The address a `fetch` call names, whichever form it came in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Every request the adapter makes, answered by the real doors. */
function routeFetchToDoors() {
  const door = appDoor();
  return vi
    .spyOn(window, 'fetch')
    .mockImplementation((input, init) =>
      Promise.resolve(
        door.request(
          new URL(urlOf(input), 'http://localhost').toString(),
          init,
        ),
      ),
    );
}

/** `run` as the mutation hook calls it: a throw while the request is built
 * rejects, the same as a refused request. */
async function run(name: string, args: Record<string, unknown>) {
  return conversationWriteAdapters[name]?.run(args, ctx);
}

const PERSON = 'conversations/mutations:assignConversation';
const TEAM = 'conversations/mutations:assignConversationTeam';

beforeEach(() => {
  assignConversation.mockResolvedValue(undefined);
  assignConversationTeam.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the assignment adapters and the doors they call', () => {
  it.each([
    [PERSON, 'assigneeUserId', assignConversation],
    [TEAM, 'assigneeTeamId', assignConversationTeam],
  ] as const)(
    '%s clears through the door with null, the Inbox’s clear',
    async (name, field, service) => {
      routeFetchToDoors();
      await expect(
        run(name, { conversationId: 'c1', [field]: null }),
      ).resolves.toBeNull();
      expect(service).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ conversationId: 'c1', [field]: null }),
      );
    },
  );

  it.each([
    [PERSON, 'assigneeUserId', assignConversation],
    [TEAM, 'assigneeTeamId', assignConversationTeam],
  ] as const)(
    '%s sets the id it names through the door',
    async (name, field, service) => {
      routeFetchToDoors();
      await expect(
        run(name, { conversationId: 'c1', [field]: 'target-2' }),
      ).resolves.toBeNull();
      expect(service).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ [field]: 'target-2' }),
      );
    },
  );

  it.each([
    [PERSON, 'assigneeUserId'],
    [TEAM, 'assigneeTeamId'],
  ] as const)(
    '%s sends nothing when its target is missing, rather than clearing',
    async (name, field) => {
      const fetchSpy = routeFetchToDoors();
      for (const args of [
        { conversationId: 'c1' },
        { conversationId: 'c1', [field]: undefined },
        { conversationId: 'c1', [field]: '' },
        { conversationId: 'c1', [field]: 42 },
      ]) {
        await expect(run(name, args)).rejects.toThrow(`Missing ${field}`);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(assignConversation).not.toHaveBeenCalled();
      expect(assignConversationTeam).not.toHaveBeenCalled();
    },
  );
});
