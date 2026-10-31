/** Real HTTP and Postgres proof of creating an automation from a template
 * of the catalog, through the app's own door with an owner's session: the
 * catalog lists the templates without where their answers go; a create
 * saves version 1 with the answers written in, installed in the answered
 * project, its event trigger off; a create that starts it deploys version 1
 * and turns its trigger on; the same name again is refused and adds no
 * version; an answer naming someone outside the organization is refused and
 * writes nothing; and a create whose last write fails inside its
 * transaction leaves no version, no deployment and no trigger behind. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { parseAutomationPresentation } from '../../../lib/shared/schemas/automation_presentation.ts';
import { appOrigin } from '../../lib/write-origin.ts';
import { createProject } from '../projects/service.ts';
import {
  AutomationError,
  deleteAutomationCascade,
  saveVersion,
} from './store.ts';
import {
  commitTemplateInstance,
  prepareTemplateInstance,
} from './templates.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const answerSchema = z.looseObject({
  error: z.string().optional(),
  name: z.string().optional(),
  version: z.number().optional(),
  deployed: z.boolean().optional(),
  trigger: z
    .looseObject({
      token: z.string().optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
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
  const started = `itest-starter-started-${suffix}`;
  const halfway = `itest-starter-halfway-${suffix}`;
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
  const create = (automation: string, reviewer: string, start = false) =>
    request('/notify-reviewer/instantiate', {
      name: automation,
      displayName: 'Tell the reviewer (itest)',
      answers: { project: projectId, reviewer },
      locale: 'de',
      ...(start && { start: true }),
    });
  const deployments = async (automation: string) =>
    sql<{ version: number }[]>`
      SELECT version FROM app.automation_deployments
      WHERE org_id = ${orgId} AND name = ${automation}
    `;
  const triggersOf = async (automation: string) =>
    sql<{ kind: string; enabled: boolean }[]>`
      SELECT kind, enabled FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${automation}
    `;
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
      'templates: the catalog lists them, without where an answer goes',
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
      'templates: a create saves version 1 with the answers, installed in the project, its trigger off [AUTO-R44]',
      created.status === 201 &&
        created.body.version === 1 &&
        first?.message === 'Created from the template "Tell the reviewer".' &&
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
      'templates: the same name again is refused and adds no version',
      again.status === 409 &&
        again.body.error === 'AUTOMATION_NAME_TAKEN' &&
        (await versions(name)).length === 1,
      `status=${again.status} body=${JSON.stringify(again.body)}`,
    );

    // Where it came from is kept beside the presentation: the presentation
    // stays the shape the previous release reads, and a later version
    // carries the template on.
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: { ...documentSchema.safeParse(first?.document).data },
      origin: appOrigin(userId),
      message: 'A second version',
    });
    const kept = await sql<
      {
        version: number;
        templateSlug: string | null;
        inPresentation: boolean;
      }[]
    >`
      SELECT version, template_slug AS "templateSlug",
             (presentation ? 'template') AS "inPresentation"
      FROM app.automations
      WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY version
    `;
    record(
      'templates: the template an automation came from is kept beside its presentation, on every version [AUTO-R58]',
      kept.length === 2 &&
        kept.every(
          (row) =>
            row.templateSlug === 'notify-reviewer' && !row.inPresentation,
        ),
      JSON.stringify(kept),
    );

    // A presentation that carries the slug itself, as one written before
    // the column did, is one a strict presentation schema cannot read:
    // migration 0212 moves the slug into the column, run twice to the same
    // end.
    await sql`
      UPDATE app.automations
         SET presentation = presentation || ${sql.json({ template: 'notify-reviewer' })},
             template_slug = NULL
       WHERE org_id = ${orgId} AND name = ${name} AND version = 1
    `;
    const strayBefore = await sql<{ presentation: unknown }[]>`
      SELECT presentation FROM app.automations
      WHERE org_id = ${orgId} AND name = ${name} AND version = 1
    `;
    const slugMove = await readFile(
      new URL(
        '../../db/migrations/0212_automation_template_slug.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await sql.unsafe(slugMove);
    await sql.unsafe(slugMove);
    const moved = await sql<
      { templateSlug: string | null; presentation: unknown }[]
    >`
      SELECT template_slug AS "templateSlug", presentation
      FROM app.automations
      WHERE org_id = ${orgId} AND name = ${name} AND version = 1
    `;
    record(
      'templates: migration 0212 moves a slug a presentation carried into its column, so the presentation reads again [AUTO-R58]',
      parseAutomationPresentation(strayBefore[0]?.presentation) === null &&
        moved.length === 1 &&
        moved[0]?.templateSlug === 'notify-reviewer' &&
        parseAutomationPresentation(moved[0].presentation) !== null,
      JSON.stringify(moved),
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
      'templates: a webhook template answers its address once, minted off',
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
      'templates: an answer naming someone outside the organization is refused, nothing written [AUTO-R45]',
      refused.status === 400 &&
        refused.body.error === 'TEMPLATE_ANSWERS_INVALID' &&
        (refused.body.data?.fields ?? []).some(
          (field) => field.field === 'reviewer' && field.code === 'unknown',
        ) &&
        (await versions(stranger)).length === 0,
      `status=${refused.status} body=${JSON.stringify(refused.body)}`,
    );

    const start = await create(started, userId, true);
    const startedTriggers = await triggersOf(started);
    record(
      'templates: a create that starts it deploys version 1 and turns its trigger on [AUTO-R61]',
      start.status === 201 &&
        start.body.version === 1 &&
        start.body.deployed === true &&
        start.body.trigger?.enabled === true &&
        (await deployments(started)).map((row) => row.version).join() === '1' &&
        startedTriggers.length === 1 &&
        startedTriggers.every((trigger) => trigger.enabled),
      `status=${start.status} body=${JSON.stringify(start.body)} triggers=${JSON.stringify(startedTriggers)}`,
    );

    // The last write of a create fails inside its transaction — a trigger
    // the store refuses, after version 1 and its deployment were written —
    // and the transaction takes both with it.
    const prepared = await prepareTemplateInstance(sql, {
      organizationId: orgId,
      slug: 'notify-reviewer',
      name: halfway,
      displayName: 'Halfway (itest)',
      answers: { project: projectId, reviewer: userId },
      viewer: { organizationId: orgId, userId, role: 'owner', teamIds: [] },
    });
    const failed = await commitTemplateInstance(sql, {
      organizationId: orgId,
      name: halfway,
      origin: appOrigin(userId),
      prepared: {
        ...prepared,
        trigger: { kind: 'schedule', cron: 'not a schedule', timezone: 'UTC' },
      },
      checked: { message: prepared.message, testsPassed: true },
      start: true,
    }).then(
      () => 'committed',
      (error: unknown) =>
        error instanceof AutomationError ? error.code : String(error),
    );
    record(
      'templates: a create whose last write fails leaves no version, deployment or trigger [AUTO-R61]',
      failed === 'AUTOMATION_TRIGGER_INVALID' &&
        (await versions(halfway)).length === 0 &&
        (await deployments(halfway)).length === 0 &&
        (await triggersOf(halfway)).length === 0,
      `outcome=${failed}`,
    );
  } finally {
    for (const automation of [name, stranger, webhook, started, halfway]) {
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
