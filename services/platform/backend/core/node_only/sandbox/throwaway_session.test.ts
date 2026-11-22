// @vitest-environment node

/**
 * What a lane's session is created with. The session's life (a failed
 * create's row, the teardown, a duplicate) is held by the render lane's
 * tests, which run through the same helper (`render_fetch.test.ts`); here is
 * what differs between the lanes that use it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../../lib/ctx';
import {
  withThrowawaySession,
  type ThrowawaySession,
} from './throwaway_session';

const spawner = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionDestroy: vi.fn(),
  sessionDestroyIfIdle: vi.fn(),
}));
vi.mock('./helpers/session_client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers/session_client')>()),
  sessionCreate: spawner.sessionCreate,
  sessionDestroy: spawner.sessionDestroy,
  sessionDestroyIfIdle: spawner.sessionDestroyIfIdle,
}));

const SESSION: ThrowawaySession = {
  organizationId: 'org_1',
  sessionId: 'vid-0123456789abcdef',
  ownerType: 'video',
  createdBy: 'system:video-links',
  idleTimeoutMs: 3 * 60_000,
  lane: 'video',
  unit: 'job',
};

function run(session: ThrowawaySession) {
  const runMutation = vi.fn(
    async (ref: unknown, _args: unknown): Promise<string | null> =>
      functionRefName(ref).split(':')[1] === 'reserveSessionSlotAndInsert'
        ? 'row_1'
        : null,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the helper uses the ctx's mutations alone
  const ctx = { runMutation } as unknown as ActionCtx;
  return {
    runMutation,
    go: () => withThrowawaySession(ctx, session, () => Promise.resolve('done')),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  spawner.sessionCreate.mockResolvedValue({ session: {} });
  spawner.sessionDestroy.mockResolvedValue(true);
  spawner.sessionDestroyIfIdle.mockResolvedValue({
    destroyed: true,
    busy: false,
  });
});

describe('what a lane’s session is created with', () => {
  // A video's sound may weigh more than the 100 MiB one file of a session
  // may be: its lane says how much, and the spawner holds the session to it.
  it('carries the per-file size a lane asks for', async () => {
    const { go } = run({ ...SESSION, maxFileBytes: 1024 * 1024 * 1024 });

    expect(await go()).toBe('done');

    expect(spawner.sessionCreate).toHaveBeenCalledTimes(1);
    expect(spawner.sessionCreate).toHaveBeenCalledWith({
      sessionId: 'vid-0123456789abcdef',
      organizationId: 'org_1',
      profile: 'default',
      placement: 'server',
      idleTimeoutMs: 3 * 60_000,
      maxFileBytes: 1024 * 1024 * 1024,
    });
  });

  it('names no per-file size for a lane that asks for none', async () => {
    const { go } = run(SESSION);

    await go();

    expect(spawner.sessionCreate).toHaveBeenCalledWith({
      sessionId: 'vid-0123456789abcdef',
      organizationId: 'org_1',
      profile: 'default',
      placement: 'server',
      idleTimeoutMs: 3 * 60_000,
    });
  });

  it('is entered in the sandbox’s books under the lane’s own kind of owner', async () => {
    const { go, runMutation } = run(SESSION);

    await go();

    const reserved = runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref).split(':')[1] === 'reserveSessionSlotAndInsert',
    );
    expect(reserved?.[1]).toEqual({
      organizationId: 'org_1',
      sessionId: 'vid-0123456789abcdef',
      profile: 'default',
      ownerType: 'video',
      ownerId: 'vid-0123456789abcdef',
      createdBy: 'system:video-links',
    });
  });
});
