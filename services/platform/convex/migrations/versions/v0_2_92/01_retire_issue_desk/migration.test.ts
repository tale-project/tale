// @vitest-environment node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  atomicWrite,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../../../lib/file_io';
import {
  restoreFsTree,
  snapshotFsTree,
} from '../../../framework/snapshot_store';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import { APP_SLUG, RETIRE_MARKER, migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

const ORG = { id: 'org1', slug: 'org1' };
const PROJECT = { id: 'project1', name: 'Engineering' };

const APP_JSON = JSON.stringify({
  name: 'Resolve GitHub issues',
  scope: 'project',
  workflows: ['issue-desk/desk-process', 'issue-desk/reconcile'],
  agents: ['desk-implementer', 'desk-reviewer'],
  requires: { integrations: ['github'] },
});
const DESK_PROCESS_JSON = JSON.stringify({ name: 'desk-process', steps: [] });
const RECONCILE_JSON = JSON.stringify({
  name: 'reconcile',
  triggers: { schedules: [{ cron: '*/15 * * * *', timezone: 'UTC' }] },
  steps: [],
});
const DESK_IMPLEMENTER_JSON = JSON.stringify({
  displayName: 'Desk Implementer',
});
const DESK_REVIEWER_JSON = JSON.stringify({ displayName: 'Desk Reviewer' });

const FN = {
  getInstallation: getFunctionName(
    internal.automations.install_mutations.getAutomationInstallationInternal,
  ),
  listBindings: getFunctionName(
    internal.automations.install_mutations.listAutomationBindingsInternal,
  ),
  getProject: getFunctionName(
    internal.projects.internal_queries.getProjectForInjection,
  ),
  deleteProjectSchedules: getFunctionName(
    internal.automations.install_mutations.deleteProjectSchedules,
  ),
  unbind: getFunctionName(
    internal.automations.install_mutations.unbindAutomationFromProject,
  ),
  bind: getFunctionName(
    internal.automations.install_mutations.bindAutomationToProject,
  ),
  upsertWorkflow: getFunctionName(
    internal.workflows.installations.upsertInstallation,
  ),
  upsertAgent: getFunctionName(
    internal.agents.installations.upsertInstallation,
  ),
  upsertAutomationInstallation: getFunctionName(
    internal.automations.install_mutations.upsertAutomationInstallation,
  ),
  reconcileSchedules: getFunctionName(
    internal.automations.install_mutations.reconcileAutomationSchedules,
  ),
  uninstall: getFunctionName(
    internal.automations.install_actions.uninstallAutomationInternal,
  ),
};

interface FakeState {
  installed: boolean;
  bindings: Array<{ projectId: string }>;
  calls: Record<string, Array<Record<string, unknown>>>;
}

function record(state: FakeState, name: string, args: unknown): void {
  (state.calls[name] ??= []).push(args as Record<string, unknown>);
}

function fakeCtx(state: FakeState, appDir: string): NodeMigrationCtx {
  return {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      if (name === FN.getInstallation) return state.installed ? {} : null;
      if (name === FN.listBindings) return state.bindings;
      if (name === FN.getProject) {
        return args.projectId === PROJECT.id
          ? { _id: PROJECT.id, name: PROJECT.name }
          : null;
      }
      throw new Error(`unexpected runQuery(${name})`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      record(state, name, args);
      return { ok: true };
    },
    runAction: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      record(state, name, args);
      if (name === FN.uninstall) {
        // Mirrors uninstallAutomationInternal's file removal.
        await rm(appDir, { recursive: true, force: true });
      }
      return { ok: true };
    },
  };
}

describe('0.2.92/01 retire_issue_desk', () => {
  let dir: string;
  let appDir: string;

  beforeEach(async () => {
    dir = await mkdtempSafe();
    vi.stubEnv('TALE_CONFIG_DIR', dir);
    appDir = path.join(dir, ORG.slug, 'apps', APP_SLUG);
    await mkdir(path.join(appDir, 'agents'), { recursive: true });
    await mkdir(path.join(appDir, 'workflows', APP_SLUG), { recursive: true });
    await writeFile(path.join(appDir, 'app.json'), APP_JSON, 'utf8');
    await writeFile(path.join(appDir, 'icon.svg'), '<svg/>', 'utf8');
    await writeFile(
      path.join(appDir, 'agents', 'desk-implementer.json'),
      DESK_IMPLEMENTER_JSON,
      'utf8',
    );
    await writeFile(
      path.join(appDir, 'agents', 'desk-reviewer.json'),
      DESK_REVIEWER_JSON,
      'utf8',
    );
    await writeFile(
      path.join(appDir, 'workflows', APP_SLUG, 'desk-process.json'),
      DESK_PROCESS_JSON,
      'utf8',
    );
    await writeFile(
      path.join(appDir, 'workflows', APP_SLUG, 'reconcile.json'),
      RECONCILE_JSON,
      'utf8',
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  async function mkdtempSafe(): Promise<string> {
    const { mkdtemp } = await import('node:fs/promises');
    return mkdtemp(path.join(tmpdir(), 'tale-mig-retireissuedesk-'));
  }

  it('is a no-op for an org without issue-desk installed', async () => {
    const state: FakeState = { installed: false, bindings: [], calls: {} };
    await migration.up(fakeCtx(state, appDir), ORG, helpers);
    expect(state.calls[FN.uninstall]).toBeUndefined();
    // The directory this test seeded is untouched (up never even looked at it).
    expect(await readFileSafe(path.join(appDir, 'app.json'))).toBe(APP_JSON);
  });

  it('up unbinds every project, uninstalls, and removes the directory', async () => {
    const state: FakeState = {
      installed: true,
      bindings: [{ projectId: PROJECT.id }],
      calls: {},
    };
    await migration.up(fakeCtx(state, appDir), ORG, helpers);

    expect(state.calls[FN.deleteProjectSchedules]).toEqual([
      {
        organizationId: ORG.id,
        automationSlug: APP_SLUG,
        projectId: PROJECT.id,
      },
    ]);
    expect(state.calls[FN.unbind]).toEqual([
      {
        organizationId: ORG.id,
        automationSlug: APP_SLUG,
        projectId: PROJECT.id,
      },
    ]);
    expect(state.calls[FN.uninstall]).toEqual([
      { organizationId: ORG.id, automationSlug: APP_SLUG },
    ]);
    expect(await readFileSafe(path.join(appDir, 'app.json'))).toBeNull();
  });

  it('down restores the directory, re-registers rows, and rebinds projects', async () => {
    const state: FakeState = {
      installed: true,
      bindings: [{ projectId: PROJECT.id }],
      calls: {},
    };
    await migration.up(fakeCtx(state, appDir), ORG, helpers);
    await migration.down(fakeCtx(state, appDir), ORG, helpers);

    expect(await readFile(path.join(appDir, 'app.json'), 'utf8')).toBe(
      APP_JSON,
    );
    // The bookkeeping sidecar never survives into the restored bundle.
    expect(
      await readFileSafe(path.join(appDir, '.migration-v0_2_92-bindings.json')),
    ).toBeNull();

    expect(state.calls[FN.upsertWorkflow]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: ORG.id,
          workflowSlug: 'issue-desk/desk-process',
          installedBy: RETIRE_MARKER,
          automationSlug: APP_SLUG,
        }),
        expect.objectContaining({
          organizationId: ORG.id,
          workflowSlug: 'issue-desk/reconcile',
          installedBy: RETIRE_MARKER,
          automationSlug: APP_SLUG,
        }),
      ]),
    );
    expect(state.calls[FN.upsertAgent]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentSlug: 'issue-desk/desk-implementer',
          installedBy: RETIRE_MARKER,
        }),
        expect.objectContaining({
          agentSlug: 'issue-desk/desk-reviewer',
          installedBy: RETIRE_MARKER,
        }),
      ]),
    );
    expect(state.calls[FN.upsertAutomationInstallation]).toEqual([
      expect.objectContaining({
        organizationId: ORG.id,
        automationSlug: APP_SLUG,
        automationName: 'Resolve GitHub issues',
        installedBy: RETIRE_MARKER,
        status: 'active',
        resources: [],
        requiredIntegrations: ['github'],
      }),
    ]);
    expect(state.calls[FN.bind]).toEqual([
      {
        organizationId: ORG.id,
        automationSlug: APP_SLUG,
        projectId: PROJECT.id,
        boundBy: RETIRE_MARKER,
      },
    ]);
    expect(state.calls[FN.reconcileSchedules]).toEqual([
      {
        organizationId: ORG.id,
        automationSlug: APP_SLUG,
        desired: [
          {
            workflowSlug: 'issue-desk/reconcile',
            cronExpression: '*/15 * * * *',
            timezone: 'UTC',
            projectId: PROJECT.id,
            variables: {},
          },
        ],
      },
    ]);
  });

  it('down is a no-op when the org never had issue-desk (nothing was snapshotted)', async () => {
    const state: FakeState = { installed: false, bindings: [], calls: {} };
    // Never ran `up` — no snapshot exists for this org under this migration id.
    await migration.down(fakeCtx(state, appDir), ORG, helpers);
    expect(state.calls[FN.upsertAutomationInstallation]).toBeUndefined();
    expect(state.calls[FN.bind]).toBeUndefined();
    // The directory this test seeded (never touched by `up`) is untouched.
    expect(await readFile(path.join(appDir, 'app.json'), 'utf8')).toBe(
      APP_JSON,
    );
  });
});
