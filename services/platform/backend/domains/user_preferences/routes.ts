import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getMyPreferences,
  PreferencesError,
  setChatModel,
  setCustomInstructionsEnabled,
  setMemoriesEnabled,
  setOnboardingCompleted,
  setVoiceOutput,
  upsertCustomInstructions,
} from './service.ts';

const customInstructionsSchema = z.object({
  customInstructions: z.string().max(20_000),
});

const enabledSchema = z.object({ enabled: z.boolean() });
const completedSchema = z.object({ completed: z.boolean() });
const chatModelSchema = z.object({ modelId: z.string().max(200).optional() });

function scopeOf(c: Context<OrgEnv>): { userId: string; orgId: string } {
  return { userId: c.get('sessionBundle').user.id, orgId: c.get('orgId') };
}

/** /api/app/user-preferences — the caller's own row, always self-scoped. */
export function createUserPreferenceRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    return c.json({
      preferences: await getMyPreferences(deps.sql, scopeOf(c)),
    });
  });

  app.post('/custom-instructions', async (c) => {
    const body = customInstructionsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const scope = scopeOf(c);
    try {
      await transactSerializable(deps.sql, (tx) =>
        upsertCustomInstructions(tx, scope, body.data.customInstructions),
      );
    } catch (error) {
      if (error instanceof PreferencesError) {
        return c.json({ error: error.code, message: error.message }, 400);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  const flagRoutes: [
    string,
    (
      tx: Parameters<typeof setMemoriesEnabled>[0],
      scope: { userId: string; orgId: string },
      enabled: boolean,
    ) => Promise<void>,
  ][] = [
    ['/custom-instructions-enabled', setCustomInstructionsEnabled],
    ['/memories-enabled', setMemoriesEnabled],
    ['/voice-output', setVoiceOutput],
  ];
  for (const [route, setter] of flagRoutes) {
    app.post(route, async (c) => {
      const body = enabledSchema.safeParse(await c.req.json());
      if (!body.success) {
        return c.json({ error: 'invalid body' }, 400);
      }
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        setter(tx, scope, body.data.enabled),
      );
      return c.json({ ok: true });
    });
  }

  app.post('/onboarding-completed', async (c) => {
    const body = completedSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const scope = scopeOf(c);
    await transactSerializable(deps.sql, (tx) =>
      setOnboardingCompleted(tx, scope, body.data.completed),
    );
    return c.json({ ok: true });
  });

  app.post('/chat-model', async (c) => {
    const body = chatModelSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const scope = scopeOf(c);
    try {
      await transactSerializable(deps.sql, (tx) =>
        setChatModel(tx, scope, body.data.modelId),
      );
    } catch (error) {
      if (error instanceof PreferencesError) {
        return c.json({ error: error.code, message: error.message }, 400);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  return app;
}
