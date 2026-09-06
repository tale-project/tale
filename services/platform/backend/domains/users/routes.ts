import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { MemberServiceError } from '../members/service.ts';
import {
  computePasswordExpiry,
  createMember,
  getCurrentUser,
  getLastActiveOrganizationId,
  getUserNotificationState,
  hasAnyUsers,
  markChangelogSeen,
  markToastShown,
  setMemberPassword,
  updateUserName,
  updateUserPassword,
  UserServiceError,
} from './service.ts';

const versionSchema = z.object({ version: z.string().min(1).max(100) });

const updateNameSchema = z.object({ name: z.string().min(1).max(200) });

const updatePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(1).max(1000),
  trigger: z.enum(['voluntary', 'forced']).optional(),
});

// `owner` is deliberately absent — it can never be assigned manually.
const assignableRoleSchema = z.enum([
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
]);

const createMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email().max(320),
  password: z.string().min(1).max(1000).optional(),
  displayName: z.string().max(200).optional(),
  role: assignableRoleSchema.optional(),
});

const setMemberPasswordSchema = z.object({
  newPassword: z.string().min(1).max(1000),
});

function toResponse(
  error: unknown,
): { code: string; status: 400 | 401 | 403 | 404 } | null {
  if (
    error instanceof UserServiceError ||
    // createMember writes through the members domain (add_member audit +
    // hint); its refusals (DUPLICATE_MEMBER, …) answer with their own codes.
    error instanceof MemberServiceError
  ) {
    return { code: error.code, status: error.status };
  }
  return null;
}

/** /api/app/users — profile, password lifecycle, changelog state. */
export function createUserRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // Fresh-install probe: must work before any session exists (drives the
  // sign-in ↔ sign-up redirect), mirroring the public 0.4 query.
  app.get('/has-any', async (c) => {
    return c.json({ hasAny: await hasAnyUsers(deps.sql) });
  });

  app.use(requireSession(deps.auth));

  app.get('/me', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    return c.json({ user: await getCurrentUser(deps.sql, userId) });
  });

  // Which auth accounts back this user (the settings page's "change
  // password" and Microsoft-link affordances) — the 0.5 twin of
  // `accounts/queries`.
  app.get('/accounts', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    const rows = await deps.sql<{ providerId: string }[]>`
      SELECT "providerId" FROM "account" WHERE "userId" = ${userId}
    `;
    const providers = new Set(rows.map((row) => row.providerId));
    return c.json({
      hasCredentialAccount: providers.has('credential'),
      hasMicrosoftAccount:
        providers.has('microsoft') || providers.has('entra-id'),
    });
  });

  app.get('/password-expiry', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    return c.json(await computePasswordExpiry(deps.sql, userId));
  });

  app.get('/last-active-org', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    return c.json({
      organizationId: await getLastActiveOrganizationId(deps.sql, userId),
    });
  });

  app.get('/notification-state', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    return c.json({
      state: await getUserNotificationState(deps.sql, userId),
    });
  });

  app.post('/notification-state/toast-shown', async (c) => {
    const body = versionSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const userId = c.get('sessionBundle').user.id;
    await transactSerializable(deps.sql, (tx) =>
      markToastShown(tx, userId, body.data.version),
    );
    return c.json({ ok: true });
  });

  app.post('/notification-state/changelog-seen', async (c) => {
    const body = versionSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const userId = c.get('sessionBundle').user.id;
    await transactSerializable(deps.sql, (tx) =>
      markChangelogSeen(tx, userId, body.data.version),
    );
    return c.json({ ok: true });
  });

  app.post('/update-name', async (c) => {
    const body = updateNameSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const userId = c.get('sessionBundle').user.id;
    try {
      await updateUserName(deps.sql, userId, body.data.name);
    } catch (error) {
      const mapped = toResponse(error);
      if (mapped) {
        return c.json({ error: mapped.code }, mapped.status);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  app.post('/update-password', async (c) => {
    const body = updatePasswordSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    try {
      await updateUserPassword(
        deps,
        { userId: session.user.id, email: session.user.email },
        c.req.raw.headers,
        body.data,
      );
    } catch (error) {
      const mapped = toResponse(error);
      if (mapped) {
        return c.json({ error: mapped.code }, mapped.status);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  app.post('/members', async (c) => {
    const body = createMemberSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    try {
      const result = await createMember(
        deps,
        { userId: session.user.id, email: session.user.email },
        body.data,
      );
      return c.json(result);
    } catch (error) {
      const mapped = toResponse(error);
      if (mapped) {
        return c.json({ error: mapped.code }, mapped.status);
      }
      throw error;
    }
  });

  app.post('/members/:memberId/password', async (c) => {
    const body = setMemberPasswordSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    try {
      await setMemberPassword(
        deps,
        { userId: session.user.id, email: session.user.email },
        {
          memberId: c.req.param('memberId'),
          newPassword: body.data.newPassword,
        },
      );
    } catch (error) {
      const mapped = toResponse(error);
      if (mapped) {
        return c.json({ error: mapped.code }, mapped.status);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  return app;
}
