import type { Sql } from 'postgres';

import { loadSeedablePacks } from '../../../convex/provisioning/provision_default_automations.ts';
import { automationPresentationSchema } from '../../../lib/shared/schemas/automation_presentation.ts';
import { automationSettingsSchema } from '../../../lib/shared/schemas/automation_settings.ts';
import { taskSubjectContractSchema } from '../../../lib/shared/schemas/task_contract.ts';
import { saveVersion, setTrigger } from '../automations/store.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  createProject,
  updateProjectInstructions,
} from '../projects/service.ts';
import { createTask } from '../tasks/service.ts';

/**
 * Org provisioning — the 0.5 twin of `convex/provisioning`: seed the
 * shipped default automation packs and the starter content into a fresh
 * organization. Runs from the `org.scaffold` job (the 0.4
 * afterCreateOrganization schedule), and is IDEMPOTENT so a scaffold retry
 * or a deploy-time re-run never duplicates anything:
 *
 *  - a pack an org already has any version of is skipped (its own history
 *    wins for behaviour; only the shipped presentation refreshes),
 *  - a pack the org DELETED stays deleted (the tombstone outlives deploys;
 *    saving the name again clears it),
 *  - starter content seeds only while the org has no project at all.
 *
 * The 0.4 default-AGENT provisioner is not ported: it had already been
 * gutted to a logging no-op ("returns with chat v2"), and 0.5 agents are
 * file-backed — the org scaffold seeds the builtin catalog tree.
 */

/** The 0.4 fail-at-the-door parse rule: a malformed pack half refuses the
 * seed rather than storing a shape every surface then chokes on. */
function parseOrThrow<T>(
  value: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  what: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new Error(`[provisioning] pack ${what} is not the real shape`);
  }
  return parsed.data;
}

export interface SeedPacksResult {
  provisioned: string[];
  skipped: string[];
}

/** Seed the shipped org-scope automation packs (the 0.4 `seedDefaultPacks`
 * semantics on the 0.5 store). */
export async function seedDefaultAutomationPacks(
  sql: Sql,
  organizationId: string,
): Promise<SeedPacksResult> {
  const packs = loadSeedablePacks();
  if (packs === null || packs.length === 0) {
    return { provisioned: [], skipped: [] };
  }
  const provisioned: string[] = [];
  const skipped: string[] = [];
  for (const pack of packs) {
    const document = pack.document;
    const name = document.name ?? '';
    if (!name) continue;
    const existing = await sql<{ id: string; presentation: unknown }[]>`
      SELECT id, presentation FROM app.automations
      WHERE org_id = ${organizationId} AND name = ${name}
      ORDER BY version DESC
      LIMIT 1
    `;
    if (existing.length === 0) {
      // A deliberate deletion outlives the deploy cycle: the tombstone says
      // this organization removed the pack, so provisioning must not bring
      // it back. Saving the name again (re-create, upload) clears it.
      const tombstones = await sql<{ name: string }[]>`
        SELECT name FROM app.automation_tombstones
        WHERE org_id = ${organizationId} AND name = ${name} LIMIT 1
      `;
      if (tombstones.length > 0) {
        skipped.push(name);
        continue;
      }
    }
    if (existing.length > 0) {
      // The organization's own history wins for BEHAVIOUR; only the shipped
      // display half refreshes on the newest version — nothing a run can
      // observe.
      const shipped = parseOrThrow(
        pack.presentation,
        automationPresentationSchema,
        'presentation',
      );
      const newest = existing[0];
      if (
        shipped !== undefined &&
        newest !== undefined &&
        JSON.stringify(newest.presentation) !== JSON.stringify(shipped)
      ) {
        await sql`
          UPDATE app.automations
          SET presentation = ${sql.json(JSON.stringify(shipped))}
          WHERE id = ${newest.id}
        `;
      }
      skipped.push(name);
      continue;
    }
    const contract = parseOrThrow(
      pack.taskContract,
      taskSubjectContractSchema,
      'subjects.task',
    );
    const settings = parseOrThrow(
      pack.settings,
      automationSettingsSchema,
      'settings',
    );
    const presentation = parseOrThrow(
      pack.presentation,
      automationPresentationSchema,
      'presentation',
    );
    await saveVersion(sql, {
      organizationId,
      name,
      document,
      actor: 'system:provisioning',
      message: 'Shipped default pack',
      ...(contract !== undefined ? { taskContract: contract } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(presentation !== undefined ? { presentation } : {}),
    });
    if (pack.trigger !== undefined) {
      const bound = await sql<{ id: string }[]>`
        SELECT id FROM app.automation_triggers
        WHERE org_id = ${organizationId} AND name = ${name} LIMIT 1
      `;
      if (bound.length === 0) {
        await setTrigger(sql, {
          organizationId,
          name,
          trigger: pack.trigger,
          actor: 'system:provisioning',
        });
      }
    }
    provisioned.push(name);
  }
  return { provisioned, skipped };
}

// Seeded copy must not tokenize as a real mention: `@mention` parses as the
// (nonexistent) agent handle "mention" under the permissive 'all' agent mode
// and fires phantom `task.mentioned` events on every fresh org — write "@"
// followed by a space instead (see MENTION_RE in `tasks/mentions.ts`).
const EXAMPLE_TASKS = [
  {
    title: 'Welcome — meet your assistant',
    description:
      'Your workspace comes with a general-purpose chat Assistant ready to go. Open the Agents page to browse the full catalog and install the agents you want. Then mention any installed agent with @ in a task to put them to work.',
    priority: 'p2' as const,
  },
  {
    title: 'Draft a one-page company overview',
    description:
      'A good first task to delegate: mention your Assistant with @ and ask it to draft a concise overview you can edit — or install the Content Writer agent from the Agents page and assign it there.',
    priority: 'p3' as const,
  },
  {
    title: 'Connect an connector',
    description:
      'Connect GitHub, Gmail, or another connector from Settings → Connectors, then install agents like the Software Developer or PR Reviewer from the Agents page to work your repos and inbox.',
    priority: 'p3' as const,
  },
] as const;

/**
 * Starter content — a "Getting started" project and a few example tasks
 * (left unassigned so triage can route them). Skips entirely if the org
 * already has any project; best-effort per step, a failure never blocks the
 * org.
 */
export async function seedStarterContent(
  sql: Sql,
  organizationId: string,
): Promise<void> {
  const projects = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.projects
    WHERE org_id = ${organizationId}
  `;
  if (Number(projects[0]?.count ?? '0') > 0) return;

  const auth = await getProjectAuthContext(sql, {
    organizationId,
    userId: 'system',
    role: 'owner',
  });
  let projectId: string;
  try {
    projectId = await sql.begin(async (tx) => {
      const id = await createProject(tx, auth, {
        name: 'Getting started',
        description:
          'A starter project to explore tasks and your agents. Feel free to rename or delete it.',
      });
      await updateProjectInstructions(
        tx,
        auth,
        id,
        'This is an example project. Agents working here should be concise and welcoming, and explain what they did.',
      );
      return id;
    });
  } catch (error) {
    console.error(
      '[seedStarterContent] failed to create starter project',
      error instanceof Error ? error.message : error,
    );
    return;
  }

  for (const task of EXAMPLE_TASKS) {
    try {
      await sql.begin((tx) =>
        createTask(tx, auth, {
          projectId,
          title: task.title,
          description: task.description,
          priority: task.priority,
        }),
      );
    } catch (error) {
      console.warn(
        '[seedStarterContent] failed to create example task',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
