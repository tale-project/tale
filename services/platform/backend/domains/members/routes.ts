import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  addMember,
  getCurrentMemberContext,
  getUserIdByEmail,
  listByOrganization,
  listPasskeysForMember,
  MemberServiceError,
  removeMember,
  resetTwoFactorForMember,
  revokePasskeyForMember,
  transferOwnership,
  updateMemberDisplayName,
  updateMemberRole,
} from './service.ts';

const assignableRoleSchema = z.enum([
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
]);

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: assignableRoleSchema.optional(),
});

const updateRoleSchema = z.object({ role: assignableRoleSchema });

const displayNameSchema = z.object({ displayName: z.string().min(1).max(100) });

function handleError<E extends AuthEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof MemberServiceError) {
    return c.json({ error: error.code }, error.status);
  }
  // The legal-hold gate refuses destructive paths with its own 409.
  if (error instanceof LegalHoldError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

/**
 * /api/app/members — membership management with the 0.4 guard semantics.
 * List/context are org-scoped (`?orgId=`); the by-member mutations resolve
 * the org from the member row inside the service.
 */
export function createMemberRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  const orgScoped = new Hono<OrgEnv>();
  orgScoped.use(requireOrgMember(deps.sql));
  orgScoped.get('/', async (c) => {
    return c.json({
      members: await listByOrganization(deps.sql, c.get('orgId')),
    });
  });
  orgScoped.get('/me', async (c) => {
    const session = c.get('sessionBundle');
    return c.json(
      await getCurrentMemberContext(
        deps.sql,
        { userId: session.user.id, name: session.user.name },
        c.get('orgId'),
      ),
    );
  });
  orgScoped.post('/', async (c) => {
    const body = addMemberSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    const orgId = c.get('orgId');
    try {
      const memberId = await transactSerializable(deps.sql, (tx) =>
        addMember(
          tx,
          { userId: session.user.id, email: session.user.email },
          { organizationId: orgId, ...body.data },
        ),
      );
      return c.json({ memberId });
    } catch (error) {
      return handleError(c, error);
    }
  });
  orgScoped.get('/user-id-by-email', async (c) => {
    // The lookup serves the admin add-member dialog and answers for ANY
    // registered account on the deployment (the person being added is not
    // a member yet), so it is gated exactly like the add itself — otherwise
    // every member could enumerate which emails hold an account here. The
    // refusal is one uniform 403 whatever the email says.
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'MEMBER_ADD_FORBIDDEN' }, 403);
    }
    const email = c.req.query('email') ?? '';
    if (email.trim() === '') {
      return c.json({ error: 'invalid email' }, 400);
    }
    return c.json({ userId: await getUserIdByEmail(deps.sql, email) });
  });
  app.route('/', orgScoped);

  // Member 2FA/passkey administration (org derived from the member row).
  app.get('/:memberId/passkeys', async (c) => {
    const session = c.get('sessionBundle');
    try {
      return c.json({
        passkeys: await listPasskeysForMember(
          deps.sql,
          { userId: session.user.id, email: session.user.email },
          c.req.param('memberId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/passkeys/:passkeyId/revoke', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await revokePasskeyForMember(
        deps.sql,
        { userId: session.user.id, email: session.user.email },
        {
          memberId: c.req.param('memberId'),
          passkeyId: c.req.param('passkeyId'),
        },
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/two-factor/reset', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await resetTwoFactorForMember(
        deps.sql,
        { userId: session.user.id, email: session.user.email },
        c.req.param('memberId'),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/role', async (c) => {
    const body = updateRoleSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        updateMemberRole(
          tx,
          { userId: session.user.id, email: session.user.email },
          { memberId: c.req.param('memberId'), role: body.data.role },
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/display-name', async (c) => {
    const body = displayNameSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        updateMemberDisplayName(
          tx,
          { userId: session.user.id, email: session.user.email },
          {
            memberId: c.req.param('memberId'),
            displayName: body.data.displayName,
          },
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/transfer-ownership', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        transferOwnership(
          tx,
          { userId: session.user.id, email: session.user.email },
          c.req.param('memberId'),
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:memberId', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        removeMember(
          tx,
          { userId: session.user.id, email: session.user.email },
          c.req.param('memberId'),
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
