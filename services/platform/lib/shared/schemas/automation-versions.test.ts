// @vitest-environment node

/**
 * The versions wire schemas against what the engine and the store produce:
 * the structural diff and its change summary of every shipped document, a
 * compare answer with its unified patch, the version rows each door lists
 * today (the app's history, the REST listing, the agent tool), and the
 * deploys the agent tool lists — and the fields a later door adds.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { VersionListing } from '../../../backend/domains/automations/store';
import {
  dispatch,
  type DeploymentEntry,
  type DispatchStore,
  type VersionSummary,
} from '../../engine/api/dispatch';
import { documentYaml } from '../../engine/api/document-yaml';
import { unifiedPatch } from '../../engine/api/version-patch';
import {
  type AutomationDiff,
  diffAutomationDocuments,
} from '../../engine/core/diff/automation';
import {
  type ChangeSummary,
  changeSummaryOf,
} from '../../engine/core/diff/changes';
import type { Automation } from '../../engine/core/types';
import { shippedDocuments } from '../../engine/selftest/corpus';
import { memoryStore } from '../../engine/selftest/memory-store';
import {
  AUTOMATION_WRITE_VIAS,
  automationDiffSchema,
  changeSummarySchema,
  deploymentEntrySchema,
  deploymentHistorySchema,
  versionCompareSchema,
  versionHistoryRowSchema,
  versionHistorySchema,
} from './automation-versions';

/** A value as it travels: JSON, nothing `undefined` left in it. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('what a version changed', () => {
  const documents = shippedDocuments().map((entry) => entry.document);

  it('parses the diff and the summary of every shipped document, against the one before it, itself and nothing', () => {
    expect(documents.length).toBeGreaterThan(3);
    let changed = 0;
    for (const [i, after] of documents.entries()) {
      for (const before of [documents[i - 1] ?? null, after, null]) {
        const diff = diffAutomationDocuments(before, after);
        const parsed: AutomationDiff = automationDiffSchema.parse(wire(diff));
        expect(parsed).toEqual(wire(diff));
        const summary: ChangeSummary = changeSummarySchema.parse(
          wire(changeSummaryOf(diff)),
        );
        expect(summary).toEqual(wire(changeSummaryOf(diff)));
        if (!diff.identical && !diff.first) changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('parses a rename and the references that follow it, and the package data', () => {
    const before: Automation = {
      version: 1,
      name: 'renamed',
      nodes: [
        { id: 'fetch', type: 'transform', code: 'return { n: 1 };' },
        {
          id: 'use',
          type: 'transform',
          input: { n: '{{ nodes.fetch.output.n }}' },
          code: 'return input.n;',
        },
      ],
      output: '{{ nodes.use.output }}',
    };
    const after: Automation = {
      ...before,
      nodes: [
        { id: 'load', type: 'transform', code: 'return { n: 1 };' },
        {
          id: 'use',
          type: 'transform',
          input: { n: '{{ nodes.load.output.n }}' },
          code: 'return input.n;',
        },
      ],
    };
    const diff = diffAutomationDocuments(before, after, {
      beforePackage: { settings: { retries: 1 } },
      afterPackage: { settings: { retries: 2 } },
    });
    expect(diff.counts.renamed).toBe(1);
    expect(diff.package).toHaveLength(1);
    expect(automationDiffSchema.parse(wire(diff))).toEqual(wire(diff));
    expect(changeSummarySchema.parse(wire(changeSummaryOf(diff)))).toEqual({
      nodes: { added: 0, removed: 0, changed: 0, renamed: 1 },
      package: true,
    });
  });

  it('parses a compare answer, its unified patch included, and one against nothing', () => {
    const [first, second] = documents;
    if (first === undefined || second === undefined) throw new Error('corpus');
    const diff = diffAutomationDocuments(first, second);
    const { patch, truncated } = unifiedPatch(
      documentYaml(first),
      documentYaml(second),
      { fromLabel: 'v1', toLabel: 'v2' },
    );
    const answer = wire({
      name: 'compared',
      from: 1,
      to: 2,
      ...diff,
      unified: patch,
      truncated,
    });
    expect(versionCompareSchema.parse(answer)).toEqual(answer);
    const alone = wire({
      name: 'compared',
      from: null,
      to: 1,
      ...diffAutomationDocuments(null, first),
    });
    expect(versionCompareSchema.parse(alone)).toEqual(alone);
  });

  it('refuses a summary flag that is not set the one way the diff sets it', () => {
    const summary = { nodes: { added: 0, removed: 0, changed: 1 } };
    expect(changeSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      changeSummarySchema.safeParse({ ...summary, output: false }).success,
    ).toBe(false);
  });
});

describe('a version as a history lists it', () => {
  it('names the doors the database takes', () => {
    const sql = readFileSync(
      new URL(
        '../../../backend/db/migrations/0181_automation_version_attribution.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const list = /created_via IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    expect(
      list.split(',').map((via) => via.trim().replaceAll("'", '')),
    ).toEqual([...AUTOMATION_WRITE_VIAS]);
  });

  const expected = {
    version: 2,
    message: null,
    createdBy: 'user-1',
    createdAt: 1_700_000_000_000,
    createdVia: 'mcp',
    viaInferred: false,
    clientName: 'Claude Code',
    basedOnVersion: null,
    restoredFromVersion: null,
    changes: null,
    testsPassed: null,
    testsCheckedAt: null,
    tests: null,
    deployed: false,
    lastDeployedAt: null,
  };

  it('reads the row of the app history', () => {
    const listing: VersionListing = {
      version: 2,
      message: null,
      testsPassed: null,
      testsCheckedAt: null,
      createdBy: 'user-1',
      createdAt: 1_700_000_000_000,
      createdVia: 'mcp',
      clientName: 'Claude Code',
    };
    expect(versionHistoryRowSchema.parse(wire(listing))).toEqual(expected);
  });

  it('reads the row of the REST listing, which names no door', () => {
    const row = {
      version: 2,
      message: 'tighten the triage',
      testsPassed: true,
      testsCheckedAt: 1_700_000_000_500,
      createdBy: 'api-key:user-1',
      createdAt: 1_700_000_000_000,
      deployed: true,
    };
    expect(versionHistoryRowSchema.parse(row)).toEqual({
      ...expected,
      message: 'tighten the triage',
      testsPassed: true,
      testsCheckedAt: 1_700_000_000_500,
      createdBy: 'api-key:user-1',
      createdVia: null,
      clientName: null,
      deployed: true,
    });
  });

  it('reads the answer of the agent tool', async () => {
    const memory = memoryStore();
    const store: DispatchStore = {
      list: () => memory.list(),
      get: (name, version) => memory.get(name, version),
      deployedVersion: (name) => memory.deployedVersion(name),
      async save(automation: Automation, message?: string) {
        const { version } = memory.save(automation.name, automation, message);
        return { name: automation.name, version };
      },
      async deploy(name: string, version: number) {
        memory.deploy(name, version);
        return { name, version };
      },
      listVersions: (name) => memory.listVersions(name),
    };
    const automation: Automation = {
      version: 1,
      name: 'listed',
      nodes: [{ id: 'a', type: 'transform', code: 'return 1;' }],
      output: '{{ nodes.a.output }}',
    };
    await dispatch(
      'save_automation',
      { automation, message: 'one' },
      { store },
    );
    await dispatch('save_automation', { automation }, { store });
    await dispatch(
      'deploy_automation',
      { name: 'listed', version: 1 },
      { store },
    );
    const answer = await dispatch(
      'list_versions',
      { name: 'listed' },
      { store },
    );
    const history = versionHistorySchema.parse(wire(answer));
    expect(history.deployedVersion).toBe(1);
    expect(history.nextBefore).toBeNull();
    expect(
      history.versions.map(({ version, message, deployed }) => ({
        version,
        message,
        deployed,
      })),
    ).toEqual([
      { version: 1, message: 'one', deployed: true },
      { version: 2, message: null, deployed: false },
    ]);
  });

  it('keeps what a later door adds, and reads a door it does not know as unknown', () => {
    const summary: VersionSummary = {
      version: 7,
      createdBy: 'user-1',
      createdAt: 1,
      createdVia: 'app',
      clientName: null,
    };
    const later = {
      ...summary,
      viaInferred: true,
      basedOnVersion: 5,
      restoredFromVersion: 5,
      changes: { nodes: { added: 1, removed: 0, changed: 2 }, tests: true },
      tests: { passed: 2, failed: 1, total: 3, via: 'deploy', by: 'user-2' },
      lastDeployedAt: 9,
    };
    expect(versionHistoryRowSchema.parse(later)).toMatchObject({
      createdVia: 'app',
      viaInferred: true,
      basedOnVersion: 5,
      restoredFromVersion: 5,
      changes: later.changes,
      tests: later.tests,
      lastDeployedAt: 9,
    });
    expect(
      versionHistoryRowSchema.parse({
        ...summary,
        createdVia: 'carrier-pigeon',
      }).createdVia,
    ).toBeNull();
  });
});

describe('the deploys of an automation', () => {
  it('reads the deploys the agent tool lists, a rollback by its numbers', () => {
    const entries: DeploymentEntry[] = [
      {
        version: 2,
        previousVersion: 3,
        deployedAt: 30,
        deployedBy: 'user-1',
        via: 'mcp',
      },
      {
        version: 3,
        previousVersion: 2,
        deployedAt: 20,
        deployedBy: 'user-1',
        via: null,
      },
      {
        version: 2,
        previousVersion: null,
        deployedAt: 10,
        deployedBy: 'user-2',
        via: null,
      },
    ];
    const read = entries.map((entry) =>
      deploymentEntrySchema.parse(wire(entry)),
    );
    expect(read.map(({ kind }) => kind)).toEqual([
      'rollback',
      'deploy',
      'deploy',
    ]);
    expect(read[0]).toEqual({
      version: 2,
      previousVersion: 3,
      kind: 'rollback',
      synthesized: false,
      deployedAt: 30,
      deployedBy: 'user-1',
      via: 'mcp',
      clientName: null,
    });
  });

  it('reads a history with what is live and where the next page starts', () => {
    const history = {
      live: {
        version: 4,
        deployedAt: 40,
        deployedBy: 'user-1',
        via: 'app',
        clientName: null,
        activeRuns: 2,
      },
      deployments: [
        {
          id: 'event-1',
          version: 4,
          previousVersion: null,
          kind: 'recorded',
          synthesized: true,
          deployedAt: 40,
          deployedBy: 'user-1',
          via: null,
        },
      ],
      nextBefore: { at: 40, id: 'event-1' },
    };
    const read = deploymentHistorySchema.parse(history);
    expect(read.deployments[0]).toMatchObject({
      kind: 'recorded',
      synthesized: true,
    });
    expect(read.live?.activeRuns).toBe(2);
    expect(deploymentHistorySchema.parse({ deployments: [] })).toEqual({
      live: null,
      deployments: [],
      nextBefore: null,
    });
  });
});
