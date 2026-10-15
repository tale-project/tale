import { describe, expect, test } from 'vitest';

import { configurationHash } from '../utils/configuration-hash';
import {
  agentSecretDigestScope,
  connectorCredentialDigestScope,
  managedSecretDigest,
  managedSecretDigestAsync,
} from './managed-secret';
import {
  PLATFORM_RESOURCES_MAX,
  platformConfigurationSchema,
  resourceConverged,
  resourceId,
} from './platform-resources';

/**
 * The kinds a declaration creates — projects, their labels, agents and
 * standing tasks, agent secrets and connector credentials — as one
 * declaration states them: who decides a field, what creation needs, what
 * leaving a field out means, and how a secret is compared without its value.
 */

const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const TASK = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function declare(resources: unknown[]) {
  return platformConfigurationSchema.safeParse({
    schemaVersion: 1,
    resources,
  });
}

/** A resource as a declaration file states it, before any parsing. */
interface Declared {
  kind: string;
  config: Record<string, unknown>;
  [policy: string]: unknown;
}

const project: Declared = {
  kind: 'project',
  createIfMissing: true,
  key: 'FLT',
  config: { projectId: PROJECT, name: 'Fleet' },
};
const label: Declared = {
  kind: 'project-label',
  createIfMissing: true,
  config: { projectId: PROJECT, name: 'Release' },
};
const secret: Declared = {
  kind: 'agent-secret',
  createIfMissing: true,
  config: { name: 'GITHUB_TOKEN', envName: 'TALE_CONFIG_SECRET_GITHUB' },
};
const credential: Declared = {
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
};
const agent: Declared = {
  kind: 'project-agent',
  createIfMissing: true,
  config: {
    projectId: PROJECT,
    agentId: AGENT,
    name: 'Manager',
    secrets: ['GITHUB_TOKEN'],
  },
};
const model: Declared = {
  kind: 'agent-model',
  config: {
    projectId: PROJECT,
    agentId: AGENT,
    harness: 'codex',
    model: 'example-model',
    modelProvider: 'example',
  },
};
const task: Declared = {
  kind: 'task',
  createIfMissing: true,
  initialStatus: 'todo',
  config: {
    projectId: PROJECT,
    taskId: TASK,
    title: 'Manage the fleet',
    labels: ['Release'],
    assigneeAgentId: AGENT,
  },
};
const fleet = [project, label, secret, credential, agent, model, task];
/** The fleet without one of its resources. */
const without = (left: Declared) => fleet.filter((entry) => entry !== left);

describe('a declaration creates projects, labels, agents, tasks, secrets and credentials', () => {
  test('names each by an identity of its own, one resource per identity', () => {
    const parsed = declare(fleet);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.resources.map(resourceId)).toEqual([
      `project/${PROJECT}`,
      `project-label/${PROJECT}/Release`,
      'agent-secret/GITHUB_TOKEN',
      'connector-credential/jira/Ops',
      `project-agent/${PROJECT}/${AGENT}`,
      `agent-model/${PROJECT}/${AGENT}`,
      `task/${PROJECT}/${TASK}`,
    ]);
    // A label and a credential are one whatever their name's case.
    expect(
      declare([
        label,
        { ...label, config: { projectId: PROJECT, name: 'release' } },
      ]).success,
    ).toBe(false);
    expect(
      declare([
        credential,
        { ...credential, config: { ...credential.config, name: 'OPS' } },
      ]).success,
    ).toBe(false);
  });

  test('creates only under a stable UUID it chooses, and only when it says so', () => {
    for (const [resource, field] of [
      [project, 'projectId'],
      [agent, 'agentId'],
      [task, 'taskId'],
    ] as const)
      expect(
        declare([
          ...without(resource),
          { ...resource, config: { ...resource.config, [field]: 'fleet' } },
        ]).success,
        resource.kind,
      ).toBe(false);
    // Without the policy the same identity is adopted, whatever its form.
    expect(
      declare([
        { kind: 'project', config: { projectId: 'existing', name: 'Fleet' } },
      ]).success,
    ).toBe(true);
    for (const createIfMissing of [false, 'true', 1])
      expect(
        declare([{ ...project, createIfMissing }]).success,
        String(createIfMissing),
      ).toBe(false);
  });

  test('chooses a key and a first column only when it creates', () => {
    const { createIfMissing: _project, ...adoptedProject } = project;
    expect(declare([adoptedProject]).success).toBe(false);
    const { createIfMissing: _task, ...adoptedTask } = task;
    expect(declare([...without(task), adoptedTask]).success).toBe(false);
    expect(
      declare([...without(task), { ...task, initialStatus: 'done' }]).success,
    ).toBe(false);
  });

  test('creates an agent only with the runtime and model its agent-model declares', () => {
    expect(declare(without(model)).success).toBe(false);
    const { createIfMissing: _create, ...adopted } = agent;
    expect(
      declare([
        ...fleet.filter((entry) => entry !== model && entry !== agent),
        adopted,
      ]).success,
    ).toBe(true);
  });

  test('gives every field one kind: an agent declares no harness, model, instructions or tools; a task no status or description', () => {
    for (const extra of [
      { harness: 'codex' },
      { model: 'example-model' },
      { instructions: 'x' },
      { tools: ['task_get'] },
    ])
      expect(
        declare([
          ...without(agent),
          { ...agent, config: { ...agent.config, ...extra } },
        ]).success,
        JSON.stringify(extra),
      ).toBe(false);
    for (const extra of [{ status: 'done' }, { description: 'x' }])
      expect(
        declare([
          ...without(task),
          { ...task, config: { ...task.config, ...extra } },
        ]).success,
        JSON.stringify(extra),
      ).toBe(false);
    // A label has a name alone: Tale derives its colour from it.
    expect(
      declare([
        { ...label, config: { projectId: PROJECT, name: 'x', color: 'red' } },
      ]).success,
    ).toBe(false);
  });

  test('states names as Tale stores them, and lists as sets', () => {
    expect(
      declare([{ ...project, config: { projectId: PROJECT, name: ' Fleet' } }])
        .success,
    ).toBe(false);
    const parsed = declare([
      ...without(agent),
      {
        ...agent,
        config: { ...agent.config, skills: ['pdf', 'docx'], connectors: [] },
      },
    ]);
    expect(
      parsed.data?.resources.find((entry) => entry.kind === 'project-agent')
        ?.config,
    ).toMatchObject({ skills: ['docx', 'pdf'], connectors: [] });
    expect(
      declare([
        ...without(agent),
        { ...agent, config: { ...agent.config, skills: ['pdf', 'pdf'] } },
      ]).success,
    ).toBe(false);
  });

  test('names a task’s labels whatever their case, leaving their spelling to the project’s labels', () => {
    const labelled = (labels: string[]) =>
      declare([{ ...task, config: { ...task.config, labels } }]).data
        ?.resources[0];
    const declared = labelled(['Release', 'Bug']);
    expect(declared?.config).toMatchObject({ labels: ['bug', 'release'] });
    if (declared === undefined) throw new Error('no task');
    // A project whose built-in label is `bug` and whose `Release` label is
    // declared reads the task's labels back case-folded: the same labels.
    expect(
      resourceConverged(declared, {
        projectId: PROJECT,
        taskId: TASK,
        title: 'Manage the fleet',
        labels: ['bug', 'release'],
        assigneeAgentId: AGENT,
        priority: null,
      }),
    ).toBe(true);
    expect(labelled(['Bug', 'bug'])).toBeUndefined();
  });

  test('reads a secret only from a variable under its own prefix, and a credential’s fields as its sign-in takes them', () => {
    for (const envName of ['DATABASE_URL', 'TALE_PROVIDER_KEY_X', ''])
      expect(
        declare([{ ...secret, config: { name: 'GITHUB_TOKEN', envName } }])
          .success,
        envName,
      ).toBe(false);
    for (const config of [
      // A basic credential needs its password.
      {
        ...credential.config,
        fields: { username: { env: 'TALE_CONFIG_SECRET_A' } },
      },
      // A key credential takes a token, not a password.
      {
        ...credential.config,
        authMethod: 'api-key',
        fields: { password: { env: 'TALE_CONFIG_SECRET_A' } },
      },
      // A value is never written into the declaration.
      {
        ...credential.config,
        fields: { username: 'ada', password: { env: 'TALE_CONFIG_SECRET_A' } },
      },
      // A renewed sign-in is connected in Tale.
      {
        ...credential.config,
        authMethod: 'oauth2',
        fields: { token: { env: 'TALE_CONFIG_SECRET_A' } },
      },
      // An endpoint is an https origin.
      { ...credential.config, endpoint: 'https://ops.atlassian.net/jira' },
      { ...credential.config, endpoint: 'http://ops.atlassian.net' },
    ])
      expect(
        declare([{ ...credential, config }]).success,
        JSON.stringify(config),
      ).toBe(false);
    expect(
      declare([
        credential,
        {
          ...credential,
          config: { ...credential.config, name: 'Other', isDefault: true },
        },
        {
          ...credential,
          config: { ...credential.config, name: 'Third', isDefault: true },
        },
      ]).success,
    ).toBe(false);
  });

  test(`holds as many as ${PLATFORM_RESOURCES_MAX} resources, and no more`, () => {
    const labels = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'project-label',
        config: { projectId: PROJECT, name: `label-${index}` },
      }));
    expect(declare(labels(PLATFORM_RESOURCES_MAX)).success).toBe(true);
    expect(declare(labels(PLATFORM_RESOURCES_MAX + 1)).success).toBe(false);
  });
});

describe('a field a declaration leaves out keeps what is stored', () => {
  const declared = declare([task]).data?.resources[0];
  const stored = {
    projectId: PROJECT,
    taskId: TASK,
    title: 'Manage the fleet',
    // The platform reads a task's labels case-folded.
    labels: ['release'],
    assigneeAgentId: AGENT,
    priority: 'p2',
  };

  test('converges with any stored value of an omitted field, and only with the stated one otherwise', () => {
    if (declared === undefined) throw new Error('no task');
    expect(resourceConverged(declared, stored)).toBe(true);
    expect(resourceConverged(declared, { ...stored, priority: null })).toBe(
      true,
    );
    expect(resourceConverged(declared, { ...stored, labels: [] })).toBe(false);
    expect(resourceConverged(declared, { ...stored, title: 'Other' })).toBe(
      false,
    );
    const named = declare([
      {
        kind: 'project',
        config: { projectId: PROJECT, name: 'Fleet', description: null },
      },
    ]).data?.resources[0];
    if (named === undefined) throw new Error('no project');
    const view = {
      projectId: PROJECT,
      name: 'Fleet',
      description: null,
      teamIds: ['team-a'],
    };
    expect(resourceConverged(named, view)).toBe(true);
    expect(
      resourceConverged(named, { ...view, description: 'Ops fleet' }),
    ).toBe(false);
  });
});

describe('a declared secret is compared by a slow, salted digest of its value', () => {
  const digest = (organizationId: string, scope: string, value: string) =>
    managedSecretDigest({ organizationId, scope, value });

  test('is the same for the same value, organization and secret, and never the value', () => {
    const first = digest('org-1', agentSecretDigestScope('TOKEN'), 'ghp_x');
    expect(first).toMatch(/^pbkdf2-sha256:[a-f0-9]{64}$/);
    expect(first).not.toContain('ghp_x');
    expect(digest('org-1', agentSecretDigestScope('TOKEN'), 'ghp_x')).toBe(
      first,
    );
    expect(digest('org-1', agentSecretDigestScope('TOKEN'), 'ghp_y')).not.toBe(
      first,
    );
    // Bound to its organization and its secret: the same value elsewhere
    // proves nothing about this one.
    expect(digest('org-2', agentSecretDigestScope('TOKEN'), 'ghp_x')).not.toBe(
      first,
    );
    expect(digest('org-1', agentSecretDigestScope('OTHER'), 'ghp_x')).not.toBe(
      first,
    );
    // Not the plain hash of the value.
    expect(first.slice('pbkdf2-sha256:'.length)).not.toBe(
      configurationHash('ghp_x'),
    );
  });

  test('digests a credential’s fields whatever their order, and its name whatever its case', () => {
    const scope = connectorCredentialDigestScope('jira', 'Ops');
    expect(scope).toBe(connectorCredentialDigestScope('jira', 'OPS'));
    expect(
      managedSecretDigest({
        organizationId: 'org-1',
        scope,
        value: { username: 'ada', password: 'x' },
      }),
    ).toBe(
      managedSecretDigest({
        organizationId: 'org-1',
        scope,
        value: { password: 'x', username: 'ada' },
      }),
    );
  });

  test('is the same whether the platform derives it on its thread pool or the CLI on its own thread', async () => {
    for (const value of ['ghp_x', { username: 'ada', password: 'x' }]) {
      const args = {
        organizationId: 'org-1',
        scope: agentSecretDigestScope('TOKEN'),
        value,
      };
      expect(await managedSecretDigestAsync(args)).toBe(
        managedSecretDigest(args),
      );
    }
  });
});
