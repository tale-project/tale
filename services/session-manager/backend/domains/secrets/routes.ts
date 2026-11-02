import { Hono } from 'hono';
import { z } from 'zod';

import {
  SECRET_KINDS,
  secretCreateSchema,
  secretKindSchema,
  secretUpdateSchema,
  type SecretKind,
  type SecretUpdate,
} from '../../../lib/api/schemas.ts';
import { AppError } from '../../errors.ts';
import {
  notFound,
  parseBody,
  parseQuery,
  pathId,
  queryBoolean,
} from '../../lib/http-input.ts';
import type { Manager, SecretScope } from '../sessions/manager.ts';

const listQuerySchema = z.object({
  kind: z.string().optional(),
  scope: z.string().optional(),
  includeGlobal: queryBoolean.default(false),
});

/**
 * `all`, `global` (the secrets for every session) or the id of a session (its
 * own; with `includeGlobal` also those for every session). The manager knows
 * whether that session exists.
 */
function scopeOf(value: string | undefined): SecretScope {
  if (value === undefined || value === 'all') return 'all';
  if (value === 'global') return value;
  if (/^\d+$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id)) {
      if (id < 1) throw notFound('session', id);
      return id;
    }
  }
  throw new AppError(
    422,
    'invalid_scope',
    'The scope must be all, global or a session id.',
  );
}

function kindOf(value: string | undefined): SecretKind | null {
  if (value === undefined) return null;
  const kind = secretKindSchema.safeParse(value);
  if (kind.success) return kind.data;
  throw new AppError(
    422,
    'invalid_kind',
    `The kind of secret must be one of: ${SECRET_KINDS.join(', ')}.`,
  );
}

/**
 * Sent, even as null, `sessionId` moves the secret: null makes it one for every
 * session. Missing leaves it where it is.
 */
function sessionChange(update: SecretUpdate): 'keep' | 'global' | number {
  if (update.sessionId === undefined) return 'keep';
  return update.sessionId === null ? 'global' : update.sessionId;
}

/** `/api/secrets`: personal information, credentials, cards and notes. */
export function createSecretRoutes(manager: Manager): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    const query = parseQuery(c, listQuerySchema);
    return c.json(
      manager.listSecrets({
        scope: scopeOf(query.scope),
        kind: kindOf(query.kind),
        includeGlobal: query.includeGlobal,
      }),
    );
  });

  routes.post('/', async (c) => {
    const secret = await parseBody(c, secretCreateSchema);
    return c.json(manager.createSecret(secret), 201);
  });

  // The one place with the masked values: the page shows them on request.
  routes.get('/:id', (c) => c.json(manager.getSecret(pathId(c, 'secret'))));

  routes.patch('/:id', async (c) => {
    const id = pathId(c, 'secret');
    const update = await parseBody(c, secretUpdateSchema);
    return c.json(
      manager.updateSecret(id, {
        title: update.title,
        fields: update.fields,
        session: sessionChange(update),
      }),
    );
  });

  routes.delete('/:id', (c) => {
    manager.deleteSecret(pathId(c, 'secret'));
    return c.body(null, 204);
  });

  return routes;
}
