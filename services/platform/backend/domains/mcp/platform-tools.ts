/**
 * The MCP tools the platform answers from its own records rather than the
 * automation engine's method table: what the app's own screens read, for the
 * caller, under the app's own rules. Each answers like an engine tool — a
 * result, or a refusal as data (`{error, code, hint}`).
 *
 * The discovery tools list what an automation may name — models, agent
 * runtimes, skills, connectors, secret names, projects and events — from the
 * same readers the editor's pickers use, so an agent is offered what a
 * person at the editor would be, and nothing of another organization's. No
 * answer carries a secret's value.
 */

import type { Sql } from 'postgres';

import { EVENT_DESCRIPTIONS } from '../../../lib/shared/event-types.ts';
import {
  DEFAULT_HARNESS,
  offeredToHarness,
  toModelOptions,
} from '../../../lib/shared/harness-offer.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { listConnectorSummaries } from '../../core/connector_credentials/connector_catalog.ts';
import { loadHarnesses } from '../../core/lib/providers/load_system_config.ts';
import { listAgentSecrets } from '../agent_secrets/service.ts';
import { getOrgAutomationMetrics } from '../automations/metrics.ts';
import {
  automationVisible,
  readableProject,
} from '../automations/project-visibility.ts';
import { listAutomations } from '../automations/store.ts';
import {
  listAutomationCapabilities,
  listGovernedChatModels,
  listManagedHarnesses,
  listProjectCapabilities,
} from '../chat/composer.ts';
import { listConnectedConnectorSlugs } from '../connector_credentials/service.ts';
import { getProjectAuthContext, listProjects } from '../projects/service.ts';
import type { McpCaller } from './caller.ts';

/** The run figures the automations metrics page shows — every member reads
 * them in the app, so every member's agent does. */
async function automationMetrics(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const periodDays =
    params.periodDays === 30 ? 30 : params.periodDays === 90 ? 90 : 7;
  const mode = params.mode === 'mock' ? 'mock' : 'live';
  return {
    periodDays,
    mode,
    ...(await getOrgAutomationMetrics(sql, caller.organizationId, {
      periodDays,
      mode,
    })),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Whether a listing row matches a filter, case-insensitively. */
function matches(query: string | undefined, ...fields: string[]): boolean {
  if (query === undefined) return true;
  const needle = query.trim().toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(needle));
}

/** How a listed model is served: by a provider directly (an API key or the
 * deployment's own credential), or by a member's subscription — a vendor
 * key (`subscription`) or the broker's sign-in (`broker`). */
function laneOf(authMethod: string): 'direct' | 'subscription' | 'broker' {
  if (authMethod === 'subscription-key') return 'subscription';
  if (authMethod === 'subscription-broker') return 'broker';
  return 'direct';
}

/**
 * The models the caller may use, as the editor's pickers offer them: the
 * organization's servable catalog filtered by the caller's model access,
 * each with the step types it suits — an llm step takes only a directly
 * served model, an agent step one offered to its runtime — and the managed
 * runtimes it is offered to (`offeredToHarness`, the pickers' rule).
 */
async function listModels(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const harness = text(params.harness);
  const nodeType = text(params.nodeType);
  const runtimes = listManagedHarnesses();
  const hint =
    'an llm step names model; an agent step names model and modelProvider (providerSlug) and runs on one of harnesses — list_harnesses shows them';
  if (
    harness !== undefined &&
    !runtimes.some((runtime) => runtime.harness === harness)
  ) {
    return {
      models: [],
      hint: `"${harness}" is not an agent runtime this deployment runs — list_harnesses shows the ones it does`,
    };
  }
  const rows = await listGovernedChatModels(sql, {
    organizationId: caller.organizationId,
    userId: caller.userId,
  });
  const options = toModelOptions(rows);
  const models = rows.flatMap((row, index) => {
    const option = options[index];
    if (option === undefined) return [];
    const lane = laneOf(row.credential.authMethod);
    const harnesses = runtimes
      .filter((runtime) =>
        offeredToHarness(option, runtime.harness, runtime.toolCallingWire),
      )
      .map((runtime) => runtime.harness);
    const nodeTypes = [
      ...(lane === 'direct' ? ['llm'] : []),
      ...(harnesses.length > 0 ? ['agent'] : []),
    ];
    if (nodeType !== undefined && !nodeTypes.includes(nodeType)) return [];
    if (harness !== undefined && !harnesses.includes(harness)) return [];
    return [
      {
        id: row.id,
        label: row.label,
        providerSlug: row.providerSlug,
        providerLabel: row.providerLabel,
        lane,
        nodeTypes,
        ...(harnesses.length > 0 && { harnesses }),
        contextWindow: row.contextWindow,
        ...(row.vision === true && { vision: true }),
      },
    ];
  });
  return { models, hint };
}

/** The runtimes an agent step can run on — the managed lane's roster the
 * pickers list — with the default and whether a subscription can serve
 * each. */
function listHarnessesTool(): unknown {
  const declared = new Map(
    loadHarnesses().map((harness) => [
      harness.slug,
      harness.subscription !== undefined,
    ]),
  );
  return {
    harnesses: listManagedHarnesses().map((runtime) => ({
      slug: runtime.harness,
      label: runtime.label,
      default: runtime.harness === DEFAULT_HARNESS,
      toolCallingWire: runtime.toolCallingWire,
      subscription: declared.get(runtime.harness) ?? false,
    })),
    hint: 'an agent step names one as harness; leave harness out for the default — list_models with harness shows the models it can run',
  };
}

/** Who the caller is to the projects' access rules. */
function projectAuth(sql: Sql, caller: McpCaller) {
  return getProjectAuthContext(sql, {
    organizationId: caller.organizationId,
    userId: caller.userId,
    role: caller.role,
  });
}

/** The skills an agent step can equip — the organization's, or a
 * project's (its teams' skills too), as the automation and project-agent
 * pickers read them. A project needs the caller's read access. */
async function listSkills(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const projectId = text(params.projectId);
  // A project the caller cannot read — or one of another organization —
  // reads as one that does not exist, as on every MCP read.
  if (
    projectId !== undefined &&
    (await readableProject(sql, await projectAuth(sql, caller), projectId)) ===
      null
  ) {
    return {
      error: `no project "${projectId}" you can read`,
      code: 'PROJECT_NOT_FOUND',
      hint: 'list_projects shows the projects you can read',
    };
  }
  const { skills } =
    projectId === undefined
      ? await listAutomationCapabilities(
          sql,
          { organizationId: caller.organizationId },
          { attribution: false },
        )
      : await listProjectCapabilities(
          sql,
          {
            organizationId: caller.organizationId,
            userId: caller.userId,
            projectId,
          },
          { attribution: false },
        );
  return {
    skills: skills.map((skill) => {
      const row: { slug: string; description?: string } = {
        slug: skill.slug,
      };
      if (skill.description !== undefined) row.description = skill.description;
      return row;
    }),
    hint: 'an agent step names them by slug under skills; a person adds one in Settings › Skills',
  };
}

/** The connectors this deployment offers and whether the organization
 * connected each — the connectors page's catalog and the pickers' set. */
async function listConnectors(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = text(params.query);
  const connected = new Set(
    await listConnectedConnectorSlugs(sql, caller.organizationId),
  );
  return {
    connectors: listConnectorSummaries()
      .filter((summary) =>
        matches(query, summary.slug, summary.displayName, summary.description),
      )
      .map((summary) => ({
        slug: summary.slug,
        name: summary.displayName,
        description: summary.description,
        connected: connected.has(summary.slug),
        actions: summary.actionCount,
      })),
    hint: 'an agent step equips a connected one by slug under connectors; a step running one of its actions is typed "<slug>.<action>" (search_catalog lists them); a person connects one in Settings › Connectors',
  };
}

/** The names of the organization's agent secrets, with their masked
 * previews — the secrets listing's own rule: owners, admins and developers
 * see them, anyone else an empty list. A value never leaves its row. */
async function listSecrets(sql: Sql, caller: McpCaller): Promise<unknown> {
  const hint =
    "an agent step names them under secrets; the step runs with each as an environment variable. A person stores a value under Secrets in the agent step in the editor (or in a project agent's), never through this endpoint";
  if (!isAdminOrDeveloperRole(caller.role)) {
    return {
      secrets: [],
      note: 'only owners, admins and developers see the names of agent secrets',
      hint,
    };
  }
  return {
    // Only these three fields leave a row — whatever else a row carries.
    secrets: (await listAgentSecrets(sql, caller.organizationId)).map(
      (secret) => {
        const row: { name: string; description?: string; preview?: string } = {
          name: secret.name,
        };
        if (secret.description !== null) row.description = secret.description;
        if (secret.maskedPreview !== null) row.preview = secret.maskedPreview;
        return row;
      },
    ),
    hint,
  };
}

/** The projects the caller can read, as the projects list shows them, with
 * the automations installed in each. */
async function listProjectsTool(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const query = text(params.query);
  const auth = await projectAuth(sql, caller);
  const projects = (
    await listProjects(sql, auth, {
      includeArchived: params.includeArchived === true,
      summary: true,
    })
  ).filter((project) => matches(query, project.name));
  const installed = new Map<string, string[]>();
  if (projects.length > 0) {
    const readable = new Set(projects.map((project) => project.id));
    for (const automation of await listAutomations(
      sql,
      caller.organizationId,
    )) {
      if (!automationVisible(automation.projectIds, readable)) continue;
      for (const projectId of automation.projectIds) {
        installed.set(projectId, [
          ...(installed.get(projectId) ?? []),
          automation.name,
        ]);
      }
    }
  }
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      archived: project.archivedAt !== null,
      writable: project.canEdit,
      automations: installed.get(project.id) ?? [],
    })),
    hint: 'start_run, save_automation and set_automation_projects take a project id; installing or running in one needs writable',
  };
}

/** The events an event trigger can wait for — the ones Tale raises. */
function listEvents(): unknown {
  return {
    events: Object.entries(EVENT_DESCRIPTIONS).map(([name, description]) => ({
      name,
      description,
    })),
    hint: 'set_trigger binds one: {kind: "event", event: "<name>"}; each run starts with the input {trigger: "event", event, payload}',
  };
}

/** One platform tool, acting as the caller in the caller's organization. */
export async function dispatchPlatformTool(
  sql: Sql,
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'get_automation_metrics':
      return automationMetrics(sql, caller, params);
    case 'list_models':
      return listModels(sql, caller, params);
    case 'list_harnesses':
      return listHarnessesTool();
    case 'list_skills':
      return listSkills(sql, caller, params);
    case 'list_connectors':
      return listConnectors(sql, caller, params);
    case 'list_agent_secrets':
      return listSecrets(sql, caller);
    case 'list_projects':
      return listProjectsTool(sql, caller, params);
    case 'list_events':
      return listEvents();
    default:
      return {
        error: `unknown platform tool "${method}"`,
        code: 'UNKNOWN_METHOD',
        hint: 'tools/list shows the tools this endpoint serves',
      };
  }
}
