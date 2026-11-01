import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  MEMBER_LOOKUP_LIMIT,
  MEMBER_LOOKUP_VALUE_MAX_LENGTH,
  MEMBER_SEARCH_QUERY_MAX_LENGTH,
} from '../../../lib/shared/constants/member-lookup.ts';
import { isTypeableHandle } from '../../../lib/shared/mention-handles.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import {
  formatKeysetCursor,
  pageLimit,
  parseKeysetCursor,
} from '../../rest/shared.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  getProjectAuthContext,
  ProjectError,
  readableProjectTeamIds,
} from '../projects/service.ts';
import {
  addMember,
  getCurrentMemberContext,
  getUserIdByEmail,
  listByOrganization,
  listPasskeysForMember,
  lookupMembers,
  MEMBER_SEARCH_PAGE_LIMITS,
  MemberServiceError,
  removeMember,
  resetTwoFactorForMember,
  revokePasskeyForMember,
  searchMembers,
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

/** One comma list of a query parameter: each value trimmed and once, the
 * empty ones dropped. */
function commaList(value: z.ZodType<string, string>) {
  return z
    .string()
    .optional()
    .transform((list) => [
      ...new Set(
        (list ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== ''),
      ),
    ])
    .pipe(z.array(value));
}

const lookupQuerySchema = z
  .object({
    userIds: commaList(z.string().max(MEMBER_LOOKUP_VALUE_MAX_LENGTH)),
    handles: commaList(
      z
        .string()
        .max(MEMBER_LOOKUP_VALUE_MAX_LENGTH)
        .transform((handle) => handle.toLowerCase())
        .refine(isTypeableHandle, 'is not a handle a mention can name'),
    ),
  })
  .refine(
    (query) =>
      query.userIds.length + query.handles.length <= MEMBER_LOOKUP_LIMIT,
    `names more than ${MEMBER_LOOKUP_LIMIT} user ids and handles`,
  );

const searchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((q) => (q ?? '').trim().replaceAll(/\s+/g, ' '))
    .pipe(z.string().max(MEMBER_SEARCH_QUERY_MAX_LENGTH)),
  projectId: z.string().min(1).optional(),
  access: z.enum(['read', 'edit']).optional(),
});

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
  // The people a screen names, by user id or `@handle`, for any member: the
  // app resolves what it shows without reading every member [MEMBER-R11].
  orgScoped.get('/lookup', async (c) => {
    const query = lookupQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    return c.json({
      members: await lookupMembers(deps.sql, c.get('orgId'), query.data),
    });
  });
  // The members whose name or email holds what was typed, a page at a time
  // in the order they joined, for any member: what a picker offers without
  // reading every member. A project keeps the people who can read it
  // [MEMBER-R12].
  orgScoped.get('/search', async (c) => {
    const query = searchQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    const rawCursor = c.req.query('cursor') ?? '';
    const cursor = parseKeysetCursor(rawCursor);
    if (rawCursor !== '' && cursor === null) {
      return c.json(
        {
          error: 'INVALID_CURSOR',
          message: 'The "cursor" query parameter is not one this list answered',
        },
        400,
      );
    }
    const { q, projectId } = query.data;
    // Who cannot read a project is no one to offer in it: a project asks
    // for readers at least.
    const access =
      query.data.access ?? (projectId === undefined ? undefined : 'read');
    let projectTeamIds: string[] | undefined;
    if (projectId !== undefined) {
      const session = c.get('sessionBundle');
      try {
        const auth = await getProjectAuthContext(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            role: c.get('orgMember').role,
          },
          session.user.email,
        );
        projectTeamIds = await readableProjectTeamIds(
          deps.sql,
          auth,
          projectId,
        );
      } catch (error) {
        // A project the caller cannot read answers as the projects do, and
        // says nothing about who can.
        if (error instanceof ProjectError) {
          return c.json({ error: error.code }, error.status);
        }
        throw error;
      }
    }
    const page = await searchMembers(deps.sql, c.get('orgId'), {
      query: q,
      ...(access === undefined ? {} : { access }),
      ...(projectTeamIds === undefined ? {} : { projectTeamIds }),
      limit: pageLimit(c.req.query('limit'), MEMBER_SEARCH_PAGE_LIMITS),
      cursor,
    });
    return c.json({
      members: page.members,
      isDone: page.next === null,
      continueCursor:
        page.next === null
          ? ''
          : formatKeysetCursor(page.next.at, page.next.id),
    });
  });
  orgScoped.get('/me', async (c) => {
    const session = c.get('sessionBundle');
    return c.json(
      await getCurrentMemberContext(
        deps.sql,
        { userId: session.user.id, name: session.user.name },
        c.get('orgId'),
        // The role the org gate enforces on this request — a trusted-headers
        // session's asserted role included — so the app shows exactly the
        // authority the backend grants, never a stale seat.
        c.get('orgMember').role,
      ),
    );
  });
  orgScoped.post('/', async (c) => {
    const body = addMemberSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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
      await transactSerializable(deps.sql, (tx) =>
        revokePasskeyForMember(
          tx,
          { userId: session.user.id, email: session.user.email },
          {
            memberId: c.req.param('memberId'),
            passkeyId: c.req.param('passkeyId'),
          },
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:memberId/two-factor/reset', async (c) => {
    const session = c.get('sessionBundle');
    try {
      await transactSerializable(deps.sql, (tx) =>
        resetTwoFactorForMember(
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

  app.post('/:memberId/role', async (c) => {
    const body = updateRoleSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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
      return invalidBodyResponse(c, body.error);
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
