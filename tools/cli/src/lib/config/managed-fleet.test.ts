import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentSecretDigestScope,
  connectorCredentialDigestScope,
  managedSecretDigest,
} from '@tale/shared/config/managed-secret';

import { managedConfigurationHash } from '../../../../../services/platform/backend/core/lib/config_store/value_hash';
import { isManagedResource } from './managed-resources';
import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
  readPlatformConfiguration,
} from './platform-apply';
import type { PlatformConfigurationClient } from './platform-client';
import { parsePlatformConfiguration } from './platform-model';

/**
 * A fleet a declaration creates whole — a project, its label, an agent
 * secret, a connector credential, an agent with its runtime, instructions
 * and tools, a standing task with its description, and the dispatch that
 * names them — against a stateful stand-in for the platform's managed
 * routes. The platform's own suites hold the writers; this holds the plan
 * and apply flow: what is read, created, adopted, compared and kept secret.
 */

const ORG = 'org-1';
const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const TASK = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TOKEN = 'ghp_fleet-secret-value-0001';
const JIRA_PASSWORD = 'jira-fleet-secret-value-0002';

const environment = {
  TALE_CONFIG_SECRET_GITHUB: TOKEN,
  TALE_CONFIG_SECRET_JIRA_USER: 'ops@example.com',
  TALE_CONFIG_SECRET_JIRA_TOKEN: JIRA_PASSWORD,
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function receiptPath() {
  const root = await mkdtemp(join(tmpdir(), 'managed-fleet-'));
  roots.push(root);
  return join(root, 'receipt.json');
}

const dispatch = {
  projectId: PROJECT,
  enabled: true,
  agents: [AGENT],
  maxConcurrentRuns: 1,
  statuses: ['todo'],
  assignment: 'assigned',
  labels: { include: ['Release'] },
  standingRoles: [
    {
      key: 'manager',
      taskId: TASK,
      agentId: AGENT,
      cron: '0 * * * *',
      timezone: 'UTC',
    },
  ],
};

function fleet(
  overrides: {
    agentName?: string;
    dispatch?: object;
    taskLabels?: string[];
  } = {},
) {
  return parsePlatformConfiguration({
    schemaVersion: 1,
    resources: [
      { kind: 'project-dispatch', config: overrides.dispatch ?? dispatch },
      {
        kind: 'project-instructions',
        config: { projectId: PROJECT, instructions: 'Ship weekly.' },
      },
      {
        kind: 'task-instructions',
        config: {
          projectId: PROJECT,
          taskId: TASK,
          description: 'Keep the fleet moving.',
        },
      },
      {
        kind: 'task',
        createIfMissing: true,
        initialStatus: 'todo',
        config: {
          projectId: PROJECT,
          taskId: TASK,
          title: 'Manage the fleet',
          labels: overrides.taskLabels ?? ['Release'],
          assigneeAgentId: AGENT,
        },
      },
      {
        kind: 'agent-tools',
        config: { projectId: PROJECT, agentId: AGENT, tools: ['task_get'] },
      },
      {
        kind: 'agent-instructions',
        config: {
          projectId: PROJECT,
          agentId: AGENT,
          instructions: 'Manage.',
        },
      },
      {
        kind: 'agent-model',
        config: {
          projectId: PROJECT,
          agentId: AGENT,
          harness: 'codex',
          model: 'example-model',
          modelProvider: 'example',
        },
      },
      {
        kind: 'project-agent',
        createIfMissing: true,
        config: {
          projectId: PROJECT,
          agentId: AGENT,
          name: overrides.agentName ?? 'Manager',
          secrets: ['GITHUB_TOKEN'],
          connectors: ['jira'],
        },
      },
      {
        kind: 'connector-credential',
        createIfMissing: true,
        config: {
          connector: 'jira',
          name: 'Ops',
          authMethod: 'basic',
          endpoint: 'https://ops.atlassian.net',
          fields: {
            username: { env: 'TALE_CONFIG_SECRET_JIRA_USER' },
            password: { env: 'TALE_CONFIG_SECRET_JIRA_TOKEN' },
          },
        },
      },
      {
        kind: 'agent-secret',
        createIfMissing: true,
        config: { name: 'GITHUB_TOKEN', envName: 'TALE_CONFIG_SECRET_GITHUB' },
      },
      {
        kind: 'project-label',
        createIfMissing: true,
        config: { projectId: PROJECT, name: 'Release' },
      },
      {
        kind: 'project',
        createIfMissing: true,
        key: 'FLT',
        config: { projectId: PROJECT, name: 'Fleet' },
      },
    ],
  });
}

class NativeRefusal extends Error {}

/** Whether a request asks the platform to check a resource, writing nothing. */
const isCheck = (path: string) =>
  path.split('?')[0]?.endsWith('/check') === true;

/** The platform's managed routes for the kinds a fleet needs, over one
 * organization's state: reads answer `{config, hash}` (null for an absent
 * resource a creating read names), writes compare-and-set on the hash. */
function platform() {
  type Agent = {
    projectId: string;
    name: string;
    connectors: string[];
    secrets: string[];
    skills: string[];
    harness: string;
    model: string;
    modelProvider: string | null;
    instructions: string;
    tools: string[];
  };
  type Task = {
    projectId: string;
    title: string;
    labels: string[];
    assigneeAgentId: string | null;
    priority: string | null;
    status: string;
    description: string;
  };
  const projects = new Map<
    string,
    { name: string; description: string | null; teamIds: string[] }
  >();
  const labels = new Map<string, string[]>();
  const instructions = new Map<string, string>();
  const agents = new Map<string, Agent>();
  const tasks = new Map<string, Task>();
  const secrets = new Map<string, string>();
  const credentials = new Map<
    string,
    {
      connector: string;
      name: string;
      authMethod: string;
      endpoint: string | null;
      isDefault: boolean;
      values: Record<string, string>;
    }
  >();
  const dispatches = new Map<string, unknown>();
  const requests: { method: string; path: string; body?: unknown }[] = [];
  let failNext: string | undefined;

  const sorted = (values: string[]) => [...values].sort();
  // The platform derives a digest on every read; the stand-in remembers the
  // ones it derived, so a test reading the same value again stays fast.
  const derived = new Map<string, string>();
  const digest = (args: Parameters<typeof managedSecretDigest>[0]) => {
    const key = JSON.stringify(args);
    const known = derived.get(key) ?? managedSecretDigest(args);
    derived.set(key, known);
    return known;
  };
  const views = {
    project: (id: string) => {
      const project = projects.get(id);
      return project && { projectId: id, ...project };
    },
    label: (projectId: string, name: string) => {
      const found = (labels.get(projectId) ?? []).find(
        (label) => label.toLowerCase() === name.toLowerCase(),
      );
      return found && { projectId, name: found };
    },
    agent: (id: string) => {
      const agent = agents.get(id);
      return (
        agent && {
          projectId: agent.projectId,
          agentId: id,
          name: agent.name,
          connectors: sorted(agent.connectors),
          secrets: sorted(agent.secrets),
          skills: sorted(agent.skills),
        }
      );
    },
    task: (id: string) => {
      const task = tasks.get(id);
      return (
        task && {
          projectId: task.projectId,
          taskId: id,
          title: task.title,
          // Case-folded, as the platform reads a task's labels.
          labels: sorted(task.labels.map((label) => label.toLowerCase())),
          assigneeAgentId: task.assigneeAgentId,
          priority: task.priority,
        }
      );
    },
    secret: (name: string) => {
      const value = secrets.get(name);
      return (
        value !== undefined && {
          name,
          valueDigest: digest({
            organizationId: ORG,
            scope: agentSecretDigestScope(name),
            value,
          }),
        }
      );
    },
    credential: (connector: string, name: string) => {
      const row = credentials.get(`${connector}/${name.toLowerCase()}`);
      return (
        row && {
          connector,
          name: row.name,
          authMethod: row.authMethod,
          endpoint: row.endpoint,
          isDefault: row.isDefault,
          fields: Object.keys(row.values).sort(),
          valueDigest: digest({
            organizationId: ORG,
            scope: connectorCredentialDigestScope(connector, row.name),
            value: row.values,
          }),
        }
      );
    },
  };

  /** One managed resource: its read, and its write under compare-and-set. */
  function resource(
    view: unknown,
    query: URLSearchParams,
    method: string,
    body: Record<string, unknown> | undefined,
    write: () => void,
  ) {
    const current = view === undefined || view === false ? null : view;
    if (method === 'GET') {
      if (current === null && query.get('createIfMissing') !== 'true')
        throw new NativeRefusal('HTTP 404');
      return { config: current, hash: managedConfigurationHash(current) };
    }
    if (body?.expectedHash !== managedConfigurationHash(current))
      throw new NativeRefusal('HTTP 409 CONFIG_VERSION_CONFLICT');
    if (current === null && body.createIfMissing !== true)
      throw new NativeRefusal('HTTP 404');
    write();
    return { ok: true };
  }

  const client: PlatformConfigurationClient = {
    target: {
      origin: 'https://tale.example',
      organizationId: ORG,
      organizationSlug: 'example',
    },
    request: async (path, method = 'GET', raw) => {
      requests.push({
        method,
        path,
        ...(raw !== undefined ? { body: raw } : {}),
      });
      const body = raw as Record<string, unknown> | undefined;
      const config = body?.config as Record<string, never> | undefined;
      const url = new URL(path, 'https://tale.example');
      const query = url.searchParams;
      const parts = url.pathname.split('/').slice(3).map(decodeURIComponent);
      const lose = (route: string) => {
        if (method === 'POST' && failNext === route) {
          failNext = undefined;
          throw new NativeRefusal('response lost after the platform wrote');
        }
      };
      const guard = (projectId: string) => {
        if (!projects.has(projectId)) throw new NativeRefusal('HTTP 404');
      };
      // /projects/:id/configuration/instructions: what a project created
      // empty holds until its declared instructions are written.
      if (
        parts[0] === 'projects' &&
        parts[2] === 'configuration' &&
        parts[3] === 'instructions'
      ) {
        const id = parts[1] ?? '';
        guard(id);
        return resource(
          { projectId: id, instructions: instructions.get(id) ?? '' },
          query,
          method,
          body,
          () => instructions.set(id, config?.instructions ?? ''),
        );
      }
      // /projects/:id/configuration/project
      if (parts[0] === 'projects' && parts[2] === 'configuration') {
        const id = parts[1] ?? '';
        const answer = resource(views.project(id), query, method, body, () =>
          projects.set(id, {
            name: config?.name ?? '',
            description:
              config?.description ?? projects.get(id)?.description ?? null,
            teamIds: config?.teamIds ?? projects.get(id)?.teamIds ?? [],
          }),
        );
        if (method === 'POST' && !labels.has(id))
          labels.set(id, ['bug', 'feature', 'improvement']);
        lose('project');
        return answer;
      }
      // /projects/:id/agents/:agentId/configuration/:facet
      if (parts[0] === 'projects' && parts[2] === 'agents') {
        const [, projectId = '', , agentId = '', , facet] = parts;
        guard(projectId);
        const agent = agents.get(agentId);
        if (facet === 'agent') {
          const answer = resource(
            views.agent(agentId),
            query,
            method,
            body,
            () => {
              const seed = body?.seed as Partial<Agent> | undefined;
              if (agent === undefined && seed === undefined)
                throw new NativeRefusal('HTTP 400 PROJECT_AGENT_SEED_REQUIRED');
              for (const name of config?.secrets ?? [])
                if (!secrets.has(name))
                  throw new NativeRefusal(
                    'HTTP 400 PROJECT_AGENT_SECRET_UNKNOWN',
                  );
              agents.set(agentId, {
                projectId,
                name: config?.name ?? '',
                connectors: config?.connectors ?? agent?.connectors ?? [],
                secrets: config?.secrets ?? agent?.secrets ?? [],
                skills: config?.skills ?? agent?.skills ?? [],
                harness: agent?.harness ?? seed?.harness ?? '',
                model: agent?.model ?? seed?.model ?? '',
                modelProvider:
                  agent?.modelProvider ?? seed?.modelProvider ?? null,
                instructions: agent?.instructions ?? seed?.instructions ?? '',
                tools: agent?.tools ?? seed?.tools ?? [],
              });
            },
          );
          lose('agent');
          return answer;
        }
        if (agent === undefined) throw new NativeRefusal('HTTP 404');
        const facets = {
          model: () => ({
            projectId,
            agentId,
            harness: agent.harness,
            model: agent.model,
            modelProvider: agent.modelProvider,
          }),
          instructions: () => ({
            projectId,
            agentId,
            instructions: agent.instructions,
          }),
          tools: () => ({ projectId, agentId, tools: agent.tools }),
        } as const;
        const read = facets[facet as keyof typeof facets];
        return resource(read(), query, method, body, () =>
          Object.assign(agent, config),
        );
      }
      // /tasks/labels/by-project/:projectId/configuration
      if (parts[0] === 'tasks' && parts[1] === 'labels') {
        const projectId = parts[3] ?? '';
        guard(projectId);
        const name = query.get('name') ?? '';
        return resource(
          views.label(projectId, name),
          query,
          method,
          body,
          () => {
            const kept = (labels.get(projectId) ?? []).filter(
              (label) => label.toLowerCase() !== name.toLowerCase(),
            );
            labels.set(projectId, [...kept, config?.name ?? '']);
          },
        );
      }
      // /tasks/dispatch/by-project/:projectId/configuration[/check]
      if (parts[0] === 'tasks' && parts[1] === 'dispatch') {
        const projectId = parts[3] ?? '';
        const planned = body?.planned as
          | {
              project?: true;
              agents: string[];
              tasks: string[];
              labels: string[];
            }
          | undefined;
        if (parts[5] === 'check') {
          if (!projects.has(projectId) && planned?.project !== true)
            throw new NativeRefusal('HTTP 404');
          const known = {
            agents: [
              ...[...agents].flatMap(([id, agent]) =>
                agent.projectId === projectId ? [id] : [],
              ),
              ...(planned?.agents ?? []),
            ],
            tasks: [
              ...[...tasks].flatMap(([id, task]) =>
                task.projectId === projectId ? [id] : [],
              ),
              ...(planned?.tasks ?? []),
            ],
            labels: [
              ...(labels.get(projectId) ??
                (planned?.project === true
                  ? ['bug', 'feature', 'improvement']
                  : [])),
              ...(planned?.labels ?? []),
            ].map((label) => label.toLowerCase()),
          };
          const declared = config as unknown as typeof dispatch;
          const issues = [
            ...declared.agents.flatMap((id, index) =>
              known.agents.includes(id) ? [] : [{ path: `agents.${index}` }],
            ),
            ...declared.standingRoles.flatMap((role, index) =>
              known.tasks.includes(role.taskId)
                ? []
                : [{ path: `standingRoles.${index}.taskId` }],
            ),
            ...declared.labels.include.flatMap((name, index) =>
              known.labels.includes(name.toLowerCase())
                ? []
                : [{ path: `labels.include.${index}` }],
            ),
          ].map((issue) => Object.assign(issue, { message: 'refused' }));
          return issues.length > 0
            ? { ok: false, issues }
            : {
                ok: true,
                changed: true,
                hash: managedConfigurationHash(config),
              };
        }
        if (method === 'GET') guard(projectId);
        // A project without a dispatch reads as `null`, and a save creates
        // one: the kind always may.
        return resource(
          dispatches.get(projectId) ?? null,
          new URLSearchParams({ createIfMissing: 'true' }),
          method,
          body && { ...body, createIfMissing: true },
          () => dispatches.set(projectId, config),
        );
      }
      // /tasks/:taskId/configuration/{task,instructions}?projectId=
      if (parts[0] === 'tasks' && parts[2] === 'configuration') {
        const taskId = parts[1] ?? '';
        const projectId = query.get('projectId') ?? '';
        guard(projectId);
        const task = tasks.get(taskId);
        if (parts[3] === 'task') {
          const answer = resource(
            views.task(taskId),
            query,
            method,
            body,
            () => {
              if (
                config?.assigneeAgentId &&
                agents.get(config.assigneeAgentId)?.projectId !== projectId
              )
                throw new NativeRefusal('HTTP 400 TASK_ASSIGNEE_INVALID');
              // A task wears the catalog's row, matched whatever its case.
              const catalog = labels.get(projectId) ?? [];
              const worn = (config?.labels as string[] | undefined)?.map(
                (name) => {
                  const row = catalog.find(
                    (label) => label.toLowerCase() === name.toLowerCase(),
                  );
                  if (row === undefined)
                    throw new NativeRefusal('HTTP 400 TASK_LABEL_UNKNOWN');
                  return row;
                },
              );
              tasks.set(taskId, {
                projectId,
                title: config?.title ?? '',
                labels: worn ?? task?.labels ?? [],
                assigneeAgentId:
                  config?.assigneeAgentId ?? task?.assigneeAgentId ?? null,
                priority: config?.priority ?? task?.priority ?? null,
                status:
                  task?.status ??
                  (body?.initialStatus as string | undefined) ??
                  'backlog',
                description:
                  task?.description ??
                  (body?.description as string | undefined) ??
                  '',
              });
            },
          );
          lose('task');
          return answer;
        }
        if (task === undefined) throw new NativeRefusal('HTTP 404');
        return resource(
          { projectId, taskId, description: task.description },
          query,
          method,
          body,
          () => Object.assign(task, { description: config?.description }),
        );
      }
      if (parts[0] === 'agent-secrets') {
        const name = query.get('name') ?? '';
        return resource(views.secret(name), query, method, body, () =>
          secrets.set(name, String(body?.value).trim()),
        );
      }
      if (parts[0] === 'connector-credentials') {
        const connector = query.get('connector') ?? '';
        const name = query.get('name') ?? '';
        return resource(
          views.credential(connector, name),
          query,
          method,
          body,
          () => {
            const prior = credentials.get(`${connector}/${name.toLowerCase()}`);
            credentials.set(`${connector}/${name.toLowerCase()}`, {
              connector,
              name: config?.name ?? '',
              authMethod: config?.authMethod ?? '',
              endpoint: config?.endpoint ?? prior?.endpoint ?? null,
              isDefault: config?.isDefault ?? prior?.isDefault ?? true,
              values: body?.secret as Record<string, string>,
            });
          },
        );
      }
      throw new Error(`no stand-in for ${method} ${path}`);
    },
  };
  return {
    client,
    requests,
    projects,
    agents,
    tasks,
    secrets,
    credentials,
    dispatches,
    /** Lose the platform's answer to the next write of one route, after it
     * wrote. */
    loseAfterWrite(route: string) {
      failNext = route;
    },
  };
}

describe('a declaration creates a fleet whole', () => {
  test('plans every resource of a new project as created, reading nothing inside it', async () => {
    const api = platform();
    const plan = await planPlatformConfiguration(fleet(), api.client, {
      environment,
    });
    expect(plan.resources.map(({ id, action }) => [id, action])).toEqual([
      [`project/${PROJECT}`, 'create'],
      [`project-label/${PROJECT}/Release`, 'create'],
      ['agent-secret/GITHUB_TOKEN', 'create'],
      ['connector-credential/jira/Ops', 'create'],
      [`project-agent/${PROJECT}/${AGENT}`, 'create'],
      [`task/${PROJECT}/${TASK}`, 'create'],
      [`project-instructions/${PROJECT}`, 'create'],
      [`task-instructions/${PROJECT}/${TASK}`, 'create'],
      [`agent-tools/${PROJECT}/${AGENT}`, 'create'],
      [`agent-instructions/${PROJECT}/${AGENT}`, 'create'],
      [`agent-model/${PROJECT}/${AGENT}`, 'create'],
      [`project-dispatch/${PROJECT}`, 'create'],
    ]);
    // Only the project, the secret and the credential were read; nothing
    // can exist inside a project that does not.
    expect(
      api.requests
        .filter(({ method }) => method === 'GET')
        .map(({ path }) => path.split('?')[0]),
    ).toEqual([
      `/api/app/projects/${PROJECT}/configuration/project`,
      '/api/app/agent-secrets/configuration',
      '/api/app/connector-credentials/configuration',
    ]);
  });

  test('checks the dispatch against what the declaration creates, before it exists [TASK-R69]', async () => {
    const api = platform();
    await planPlatformConfiguration(fleet(), api.client, { environment });
    const check = api.requests.find(({ path }) => path.endsWith('/check'));
    expect(check?.body).toMatchObject({
      expectedHash: null,
      planned: {
        project: true,
        agents: [AGENT],
        tasks: [TASK],
        labels: ['Release'],
      },
    });
    // A dispatch naming an agent nothing declares is refused at planning,
    // before anything is written.
    const stray = '11111111-2222-4333-8444-555555555555';
    await expect(
      planPlatformConfiguration(
        fleet({ dispatch: { ...dispatch, agents: [AGENT, stray] } }),
        api.client,
        { environment },
      ),
    ).rejects.toThrow('at agents.1');
    expect(
      api.requests.filter(
        ({ method, path }) => method === 'POST' && !isCheck(path),
      ),
    ).toEqual([]);
  });

  test('sends the check only what the dispatch names of all the declaration creates [TASK-R69]', async () => {
    const api = platform();
    // More agents than a dispatch pool holds, each with its serving; the
    // dispatch names one of them.
    const workers = Array.from({ length: 60 }, (_, index) => {
      const agentId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      return [
        {
          kind: 'project-agent',
          createIfMissing: true,
          config: { projectId: PROJECT, agentId, name: `Worker ${index}` },
        },
        {
          kind: 'agent-model',
          config: {
            projectId: PROJECT,
            agentId,
            harness: 'codex',
            model: 'example-model',
            modelProvider: 'example',
          },
        },
      ];
    }).flat();
    const configuration = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        ...fleet().resources,
        ...workers,
        {
          kind: 'project-label',
          createIfMissing: true,
          config: { projectId: PROJECT, name: 'Unrelated' },
        },
      ],
    });
    await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    const check = api.requests.find(({ path }) => path.endsWith('/check'));
    expect(check?.body).toMatchObject({
      planned: {
        project: true,
        agents: [AGENT],
        tasks: [TASK],
        labels: ['Release'],
      },
    });
  });

  test('applies in dependency order, creates the agent and task whole, then plans unchanged', async () => {
    const api = platform();
    const receipt = await receiptPath();
    const configuration = fleet();
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    const result = await applyPlatformConfiguration(
      configuration,
      plan,
      api.client,
      receipt,
      { environment },
    );
    expect(result.unchanged).toBe(false);
    const writes = api.requests
      .filter(({ method, path }) => method === 'POST' && !isCheck(path))
      .map(({ path }) => path.split('?')[0]);
    expect(writes).toEqual([
      `/api/app/projects/${PROJECT}/configuration/project`,
      `/api/app/tasks/labels/by-project/${PROJECT}/configuration`,
      '/api/app/agent-secrets/configuration',
      '/api/app/connector-credentials/configuration',
      `/api/app/projects/${PROJECT}/agents/${AGENT}/configuration/agent`,
      `/api/app/tasks/${TASK}/configuration/task`,
      // Created empty with the project, its instructions are written on
      // what the creation left: nothing was there to review.
      `/api/app/projects/${PROJECT}/configuration/instructions`,
      `/api/app/tasks/dispatch/by-project/${PROJECT}/configuration`,
    ]);
    // Created whole: the agent with the runtime, model, instructions and
    // tools its other kinds declare, the task with its description, in its
    // first column.
    expect(api.agents.get(AGENT)).toMatchObject({
      name: 'Manager',
      harness: 'codex',
      model: 'example-model',
      modelProvider: 'example',
      instructions: 'Manage.',
      tools: ['task_get'],
      secrets: ['GITHUB_TOKEN'],
    });
    expect(api.tasks.get(TASK)).toMatchObject({
      status: 'todo',
      description: 'Keep the fleet moving.',
      assigneeAgentId: AGENT,
    });
    const again = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    expect(again.resources.every(({ action }) => action === 'unchanged')).toBe(
      true,
    );
  });

  test('converges a task naming its labels in another case than the project spells them [TASK-R67]', async () => {
    const api = platform();
    // `Bug` against the built-in `bug`, `release` against the declared
    // `Release` label.
    const configuration = fleet({ taskLabels: ['Bug', 'release'] });
    await applyPlatformConfiguration(
      configuration,
      await planPlatformConfiguration(configuration, api.client, {
        environment,
      }),
      api.client,
      await receiptPath(),
      { environment },
    );
    expect(api.tasks.get(TASK)?.labels).toEqual(['bug', 'Release']);
    const again = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    expect(again.resources.every(({ action }) => action === 'unchanged')).toBe(
      true,
    );
  });

  test('never reads or moves a created task’s status afterwards [TASK-R67]', async () => {
    const api = platform();
    const configuration = fleet();
    await applyPlatformConfiguration(
      configuration,
      await planPlatformConfiguration(configuration, api.client, {
        environment,
      }),
      api.client,
      await receiptPath(),
      { environment },
    );
    const task = api.tasks.get(TASK);
    if (!task) throw new Error('no task');
    task.status = 'done';
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    expect(plan.resources.every(({ action }) => action === 'unchanged')).toBe(
      true,
    );
  });

  test('finishes an apply that stopped inside a project it created, with the same plan', async () => {
    const api = platform();
    const configuration = fleet();
    const receipt = await receiptPath();
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    api.loseAfterWrite('agent');
    await expect(
      applyPlatformConfiguration(configuration, plan, api.client, receipt, {
        environment,
      }),
    ).rejects.toThrow(`stopped at project-agent/${PROJECT}/${AGENT}`);
    expect(api.agents.has(AGENT)).toBe(true);
    const finished = await applyPlatformConfiguration(
      configuration,
      plan,
      api.client,
      receipt,
      { environment },
    );
    expect(finished.configured).toBe(true);
    expect(api.dispatches.get(PROJECT)).toEqual(dispatch);
  });

  test('is hot configuration a configuration-only deployment applies whole', () => {
    // `--configuration-only` refuses a change to any resource that is not
    // managed configuration; every kind of a fleet is.
    expect(
      fleet()
        .resources.filter((resource) => !isManagedResource(resource))
        .map((resource) => resource.kind),
    ).toEqual([]);
  });
});

describe('a declaration adopts and converges what exists', () => {
  async function applied() {
    const api = platform();
    const configuration = fleet();
    await applyPlatformConfiguration(
      configuration,
      await planPlatformConfiguration(configuration, api.client, {
        environment,
      }),
      api.client,
      await receiptPath(),
      { environment },
    );
    api.requests.length = 0;
    return api;
  }

  test('updates a changed field on the hash it read, and nothing else [PROJ-R22]', async () => {
    const api = await applied();
    const configuration = fleet({ agentName: 'Fleet manager' });
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    expect(
      plan.resources.filter(({ action }) => action !== 'unchanged'),
    ).toEqual([
      expect.objectContaining({
        id: `project-agent/${PROJECT}/${AGENT}`,
        action: 'update',
      }),
    ]);
    await applyPlatformConfiguration(
      configuration,
      plan,
      api.client,
      await receiptPath(),
      { environment },
    );
    const write = api.requests.find(
      ({ method, path }) => method === 'POST' && path.includes('/agents/'),
    );
    expect(write?.body).toMatchObject({
      config: { name: 'Fleet manager' },
      expectedHash: plan.resources.find(({ id }) =>
        id.startsWith('project-agent/'),
      )?.revision,
    });
    // An update carries no seed: the agent's runtime stays the agent-model's.
    expect(write?.body).not.toHaveProperty('seed');
    expect(api.agents.get(AGENT)?.name).toBe('Fleet manager');
  });

  test('refuses what changed since planning before writing anything', async () => {
    const api = await applied();
    const configuration = fleet({ agentName: 'Fleet manager' });
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    const agent = api.agents.get(AGENT);
    if (!agent) throw new Error('no agent');
    agent.skills = ['pdf'];
    api.requests.length = 0;
    await expect(
      applyPlatformConfiguration(
        configuration,
        plan,
        api.client,
        await receiptPath(),
        { environment },
      ),
    ).rejects.toThrow(
      `changed since planning: project-agent/${PROJECT}/${AGENT}`,
    );
    expect(api.requests.filter(({ method }) => method === 'POST')).toEqual([]);
  });

  test('adopts only what exists when it may not create', async () => {
    const api = platform();
    const configuration = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        { kind: 'project', config: { projectId: PROJECT, name: 'Fleet' } },
      ],
    });
    await expect(
      planPlatformConfiguration(configuration, api.client, { environment }),
    ).rejects.toThrow('HTTP 404');
  });
});

describe('a declaration refuses at planning what it could not write inside what it creates', () => {
  const STRAY = '11111111-2222-4333-8444-555555555555';

  /** The fleet with its resources edited, re-read as a declaration. */
  function variant(
    edit: (resources: Record<string, unknown>[]) => Record<string, unknown>[],
  ) {
    return parsePlatformConfiguration({
      schemaVersion: 1,
      resources: edit([...fleet().resources]),
    });
  }

  /** The resources with one kind's `createIfMissing` dropped. */
  function adoptOnly(resources: Record<string, unknown>[], kind: string) {
    return resources.map(({ createIfMissing, ...resource }) =>
      resource.kind === kind || createIfMissing === undefined
        ? resource
        : { ...resource, createIfMissing },
    );
  }

  async function refusedBeforeWriting(
    configuration: ReturnType<typeof variant>,
    reason: string,
  ) {
    const api = platform();
    await expect(
      planPlatformConfiguration(configuration, api.client, { environment }),
    ).rejects.toThrow(reason);
    // Nothing was written.
    expect(
      api.requests.filter(
        ({ method, path }) => method === 'POST' && !isCheck(path),
      ),
    ).toEqual([]);
    expect(api.projects.size).toBe(0);
    return api;
  }

  test('an agent declared without createIfMissing in a project it creates', async () => {
    await refusedBeforeWriting(
      variant((resources) => adoptOnly(resources, 'project-agent')),
      `project-agent/${PROJECT}/${AGENT} adopts a resource inside project/${PROJECT}`,
    );
  });

  test('a label declared without createIfMissing in a project it creates', async () => {
    await refusedBeforeWriting(
      variant((resources) => adoptOnly(resources, 'project-label')),
      `project-label/${PROJECT}/Release adopts a resource inside project/${PROJECT}`,
    );
  });

  test('the model of an agent nothing declares, in a project it creates', async () => {
    await refusedBeforeWriting(
      variant((resources) => [
        ...resources,
        {
          kind: 'agent-model',
          config: {
            projectId: PROJECT,
            agentId: STRAY,
            harness: 'codex',
            model: 'example-model',
            modelProvider: 'example',
          },
        },
      ]),
      `agent-model/${PROJECT}/${STRAY} adopts a resource inside project/${PROJECT}`,
    );
  });

  test('the description of a task nothing declares, in a project it creates', async () => {
    await refusedBeforeWriting(
      variant((resources) => [
        ...resources,
        {
          kind: 'task-instructions',
          config: { projectId: PROJECT, taskId: STRAY, description: 'Stray.' },
        },
      ]),
      `task-instructions/${PROJECT}/${STRAY} adopts a resource inside project/${PROJECT}`,
    );
  });

  test('a task assigned to an agent nothing creates in the project it creates', async () => {
    await refusedBeforeWriting(
      variant((resources) =>
        resources.map((resource) =>
          resource.kind === 'task'
            ? {
                ...resource,
                config: {
                  ...(resource.config as object),
                  assigneeAgentId: STRAY,
                },
              }
            : resource,
        ),
      ),
      `task/${PROJECT}/${TASK} is assigned to agent ${STRAY}`,
    );
  });

  test('an adopting resource still adopts in a project that exists', async () => {
    const api = platform();
    const configuration = fleet();
    await applyPlatformConfiguration(
      configuration,
      await planPlatformConfiguration(configuration, api.client, {
        environment,
      }),
      api.client,
      await receiptPath(),
      { environment },
    );
    // The project exists now: an agent declared without createIfMissing
    // reads it and plans unchanged.
    const adopting = variant((resources) =>
      adoptOnly(resources, 'project-agent'),
    );
    const plan = await planPlatformConfiguration(adopting, api.client, {
      environment,
    });
    expect(plan.resources.every(({ action }) => action === 'unchanged')).toBe(
      true,
    );
  });
});

describe('a declared secret keeps its value out of everything but its write', () => {
  test('writes a value only into the secret’s own request, never into a plan, journal or refusal [ASEC-R5]', async () => {
    const api = platform();
    const configuration = fleet();
    const receipt = await receiptPath();
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    await applyPlatformConfiguration(configuration, plan, api.client, receipt, {
      environment,
    });
    const carriers = api.requests
      .filter(({ body }) => JSON.stringify(body ?? {}).includes(TOKEN))
      .map(({ path }) => path.split('?')[0]);
    expect(carriers).toEqual(['/api/app/agent-secrets/configuration']);
    expect(
      api.requests
        .filter(({ body }) =>
          JSON.stringify(body ?? {}).includes(JIRA_PASSWORD),
        )
        .map(({ path }) => path.split('?')[0]),
    ).toEqual(['/api/app/connector-credentials/configuration']);
    for (const text of [
      JSON.stringify(plan),
      await readFile(receipt, 'utf8'),
      JSON.stringify(configuration),
      JSON.stringify(
        await readPlatformConfiguration(configuration, api.client, {
          environment,
        }),
      ),
    ]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(JIRA_PASSWORD);
    }
  });

  test('reads back whether a secret holds the declared value, never the digest that verifies it [ASEC-R5]', async () => {
    const api = platform();
    const configuration = fleet();
    await applyPlatformConfiguration(
      configuration,
      await planPlatformConfiguration(configuration, api.client, {
        environment,
      }),
      api.client,
      await receiptPath(),
      { environment },
    );
    const shown = (
      read: Awaited<ReturnType<typeof readPlatformConfiguration>>,
    ) =>
      read.resources.find(({ id }) => id === 'agent-secret/GITHUB_TOKEN')
        ?.config;
    const read = await readPlatformConfiguration(configuration, api.client, {
      environment,
    });
    expect(shown(read)).toEqual({ name: 'GITHUB_TOKEN', valueMatches: true });
    expect(
      read.resources.find(({ id }) => id === 'connector-credential/jira/Ops')
        ?.config,
    ).toMatchObject({ valueMatches: true });
    expect(JSON.stringify(read)).not.toContain('pbkdf2-sha256:');
    const rotated = await readPlatformConfiguration(configuration, api.client, {
      environment: { ...environment, TALE_CONFIG_SECRET_GITHUB: 'rotated' },
    });
    expect(shown(rotated)).toEqual({
      name: 'GITHUB_TOKEN',
      valueMatches: false,
    });
  });

  test('rotates a secret whose value changed, and leaves an equal one alone [CCRED-R8]', async () => {
    const api = platform();
    const configuration = fleet();
    const first = await planPlatformConfiguration(configuration, api.client, {
      environment,
    });
    await applyPlatformConfiguration(
      configuration,
      first,
      api.client,
      await receiptPath(),
      { environment },
    );
    const rotated = {
      ...environment,
      TALE_CONFIG_SECRET_GITHUB: `${TOKEN}-rotated`,
    };
    const plan = await planPlatformConfiguration(configuration, api.client, {
      environment: rotated,
    });
    expect(
      plan.resources
        .filter(({ action }) => action !== 'unchanged')
        .map(({ id }) => id),
    ).toEqual(['agent-secret/GITHUB_TOKEN']);
    // The declaration did not change: neither did its hash, which names
    // where the value comes from, never the value.
    const desired = (candidate: typeof plan) =>
      candidate.resources.find(({ id }) => id === 'agent-secret/GITHUB_TOKEN')
        ?.desiredSha256;
    expect(desired(plan)).toBe(desired(first));
    expect(plan.configurationSha256).toBe(first.configurationSha256);
    await applyPlatformConfiguration(
      configuration,
      plan,
      api.client,
      await receiptPath(),
      { environment: rotated },
    );
    expect(api.secrets.get('GITHUB_TOKEN')).toBe(`${TOKEN}-rotated`);
    // A value replaced in Tale reads as differing, and the next apply
    // writes the declared one again.
    const credential = api.credentials.get('jira/ops');
    if (!credential) throw new Error('no credential');
    credential.values.password = 'typed-in-tale';
    const drifted = await planPlatformConfiguration(configuration, api.client, {
      environment: rotated,
    });
    expect(
      drifted.resources
        .filter(({ action }) => action !== 'unchanged')
        .map(({ id }) => id),
    ).toEqual(['connector-credential/jira/Ops']);
  });

  test('refuses a plan whose variable is not set, naming the variable alone', async () => {
    const api = platform();
    const { TALE_CONFIG_SECRET_GITHUB: _unset, ...partial } = environment;
    const refusal = planPlatformConfiguration(fleet(), api.client, {
      environment: partial,
    });
    await expect(refusal).rejects.toThrow('TALE_CONFIG_SECRET_GITHUB');
    await expect(refusal).rejects.not.toThrow(JIRA_PASSWORD);
  });
});
