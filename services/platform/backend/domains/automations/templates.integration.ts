/** Real HTTP and Postgres proof of creating an automation from a shipped
 * starter, through the app's own door with an owner's session: the gallery
 * lists the starters without where their answers go; a create saves
 * version 1 with the answers written in, installed in the answered project,
 * its event trigger off until a deploy; the same name again is refused and
 * adds no version; an answer naming someone outside the organization is
 * refused and writes nothing. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { appOrigin } from '../../lib/write-origin.ts';
import { createProject } from '../projects/service.ts';
import { deleteAutomationCascade } from './store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const answerSchema = z.looseObject({
  error: z.string().optional(),
  name: z.string().optional(),
  version: z.number().optional(),
  trigger: z.looseObject({ token: z.string().optional() }).optional(),
  data: z
    .looseObject({
      fields: z
        .array(z.looseObject({ field: z.string(), code: z.string() }))
        .optional(),
    })
    .optional(),
  templates: z
    .array(
      z.looseObject({
        slug: z.string(),
        fields: z.array(z.looseObject({ id: z.string() })),
      }),
    )
    .optional(),
});

/** The steps of a stored document, as far as this lane reads them. */
const documentSchema = z.looseObject({
  nodes: z.array(z.looseObject({ id: z.string(), input: z.unknown() })),
});

export async function checkAutomationTemplates(
  sql: Sql,
  base: string,
  ctx: { orgId: string; userId: string; cookie: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const name = `itest-starter-${suffix}`;
  const stranger = `itest-starter-stranger-${suffix}`;
  const webhook = `itest-starter-webhook-${suffix}`;
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(
      `${base}/api/app/automation-templates${route}?orgId=${orgId}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          cookie: ctx.cookie,
          origin: base,
          'content-type': 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      body: answerSchema.parse(await response.json()),
    };
  };
  const projectId = await sql.begin((tx) =>
    createProject(
      tx,
      { organizationId: orgId, userId, role: 'owner', teamIds: [] },
      { name: `Starters ${suffix}`, deriveKeyOnCollision: true },
    ),
  );
  const create = (automation: string, reviewer: string) =>
    request('/notify-reviewer/instantiate', {
      name: automation,
      displayName: 'Tell the reviewer (itest)',
      answers: { project: projectId, reviewer },
      locale: 'de',
    });
  const versions = async (automation: string) =>
    sql<{ version: number; message: string | null; document: unknown }[]>`
      SELECT version, message, document FROM app.automations
      WHERE org_id = ${orgId} AND name = ${automation}
      ORDER BY version
    `;

  try {
    const listed = await request('');
    const card = listed.body.templates?.find(
      (entry) => entry.slug === 'notify-reviewer',
    );
    record(
      'starters: the gallery lists them, without where an answer goes',
      listed.status === 200 &&
        card !== undefined &&
        card.fields.map((field) => field.id).join() ===
          'project,reviewer,message' &&
        card.fields.every((field) => !('writes' in field)),
      JSON.stringify(card),
    );

    const created = await create(name, userId);
    const [first] = await versions(name);
    const notify = documentSchema
      .safeParse(first?.document)
      .data?.nodes.find((node) => node.id === 'notify')?.input;
    const bound = await sql<{ projectId: string }[]>`
      SELECT project_id AS "projectId" FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${name}
    `;
    const triggers = await sql<
      { kind: string; event: string | null; enabled: boolean }[]
    >`
      SELECT kind, event, enabled FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    record(
      'starters: a create saves version 1 with the answers, installed in the project, its trigger off [AUTO-R44]',
      created.status === 201 &&
        created.body.version === 1 &&
        first?.message === 'Created from the starter "Tell the reviewer".' &&
        JSON.stringify(notify).includes(`"to":["${userId}"]`) &&
        JSON.stringify(notify).includes(
          'Diese Aufgabe ist bereit für deine Prüfung.',
        ) &&
        bound.map((row) => row.projectId).join() === projectId &&
        triggers.length === 1 &&
        triggers.every(
          (trigger) =>
            trigger.kind === 'event' &&
            trigger.event === 'task.status_changed' &&
            !trigger.enabled,
        ),
      `status=${created.status} body=${JSON.stringify(created.body)} message=${first?.message} notify=${JSON.stringify(notify)} bound=${JSON.stringify(bound)} triggers=${JSON.stringify(triggers)}`,
    );

    const again = await create(name, userId);
    record(
      'starters: the same name again is refused and adds no version',
      again.status === 409 &&
        again.body.error === 'AUTOMATION_NAME_TAKEN' &&
        (await versions(name)).length === 1,
      `status=${again.status} body=${JSON.stringify(again.body)}`,
    );

    const hooked = await request('/webhook-create-task/instantiate', {
      name: webhook,
      displayName: 'Tasks from a webhook (itest)',
      answers: { project: projectId },
    });
    const hooks = await sql<
      { kind: string; enabled: boolean; minted: boolean }[]
    >`
      SELECT kind, enabled, token_hash IS NOT NULL AS minted
      FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${webhook}
    `;
    record(
      'starters: a webhook starter answers its address once, minted off',
      hooked.status === 201 &&
        typeof hooked.body.trigger?.token === 'string' &&
        hooked.body.trigger.token.length > 0 &&
        hooks.length === 1 &&
        hooks.every(
          (hook) => hook.kind === 'webhook' && !hook.enabled && hook.minted,
        ),
      `status=${hooked.status} token=${hooked.body.trigger?.token === undefined ? 'absent' : 'present'} triggers=${JSON.stringify(hooks)}`,
    );

    const refused = await create(stranger, `nobody-${suffix}`);
    record(
      'starters: an answer naming someone outside the organization is refused, nothing written [AUTO-R45]',
      refused.status === 400 &&
        refused.body.error === 'TEMPLATE_ANSWERS_INVALID' &&
        (refused.body.data?.fields ?? []).some(
          (field) => field.field === 'reviewer' && field.code === 'unknown',
        ) &&
        (await versions(stranger)).length === 0,
      `status=${refused.status} body=${JSON.stringify(refused.body)}`,
    );
  } finally {
    for (const automation of [name, stranger, webhook]) {
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name: automation,
        origin: appOrigin(userId),
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${automation}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}
