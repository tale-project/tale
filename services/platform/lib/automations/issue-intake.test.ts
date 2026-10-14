// @vitest-environment node

/**
 * The issue intake packs run against the documents they call. The packs'
 * own tests stand in for the importers; these run the shipped documents
 * through a store, so each source calls a real document under the
 * importer's name: the shipped importer itself, or a stand-in that takes the
 * shipped importer's inputs, answers where it was asked to start, ends the
 * listing at `page-9` and fails for the source `gone`.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConnectors } from '../connectors/registry';
import { execute } from '../engine/core/execute';
import { setCodeRunner } from '../engine/core/runner';
import type { Automation, Effect } from '../engine/core/types';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { memoryStore } from '../engine/selftest/memory-store';
import { loadAutomationPacks } from './packs';

const REPO = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../..',
);

setCodeRunner(nodeVmRunner());
loadConnectors(path.join(REPO, 'configs/platform/system'));
const packs = loadAutomationPacks({
  root: path.join(REPO, 'configs/platform/custom'),
});

function shipped(slug: string): Automation {
  const found = packs.find((pack) => pack.slug === slug);
  if (found === undefined) throw new Error(`no shipped pack "${slug}"`);
  return found.automation;
}

const intake = shipped('issues/intake');
const intakeSource = shipped('issues/intake-source');
const githubImporter = shipped('github/import-issues');
const glitchtipImporter = shipped('glitchtip/import-issues');

/** The inputs each importer took when it first shipped, which every copy an
 * organization kept or edited since still takes. */
const FIRST_SHIPPED_INPUTS: Record<string, string[]> = {
  'github-import-issues': [
    'projectId',
    'owner',
    'repo',
    'labels',
    'limit',
    'cursor',
  ],
  'glitchtip-import-issues': [
    'projectId',
    'organization',
    'project',
    'query',
    'limit',
    'cursor',
  ],
};

function standIn(importer: Automation): Automation {
  return {
    version: 1,
    name: importer.name,
    ...(importer.inputs !== undefined && { inputs: importer.inputs }),
    nodes: [
      {
        id: 'batch',
        type: 'transform',
        input: { asked: '{{ input }}' },
        code: [
          'const asked = input.asked;',
          "if (asked.repo === 'gone' || asked.project === 'gone') throw new Error('the source answered 404');",
          "const next = asked.cursor === 'page-9' ? null : 'after:' + asked.cursor;",
          'return { imported: 1, created: 1, updated: 0, skipped: 0, truncated: next !== null, nextCursor: next, refreshHasMore: false, tasks: [] };',
        ].join('\n'),
      },
    ],
    output: '{{ nodes.batch.output }}',
  };
}

function storeWith(...importers: Automation[]) {
  const store = memoryStore();
  for (const document of [intake, intakeSource, ...importers]) {
    store.save(document.name, document);
  }
  return store;
}

const standIns = () =>
  storeWith(standIn(githubImporter), standIn(glitchtipImporter));

/** What `task.get_import_cursor` answers for a pass at `cursor`. */
function position(cursor: string, batch: number) {
  return {
    cursor,
    revision: '41',
    batch,
    resumed: cursor !== '',
    restarted: false,
    passStartedAt: cursor === '' ? null : 1_790_000_000_000,
    lastDrainedAt: null,
  };
}

function saves(effects: Effect[]): unknown[] {
  return effects
    .filter((effect) => effect.connector === 'task.save_import_cursor')
    .map((effect) => effect.input);
}

const github = (repo: string) => ({ kind: 'github', owner: 'example', repo });

describe('the intake of one issue source', () => {
  it('imports the batch its saved position names and saves where that batch stopped [AUTO-R57]', async () => {
    const run = await execute(intakeSource, {
      input: { projectId: 'proj_1', source: github('web') },
      mode: 'mock',
      store: standIns(),
      bench: { mocks: { position: position('page-2', 2) } },
    });
    expect(run.status).toBe('success');
    expect(saves(run.effects)).toEqual([
      {
        projectId: 'proj_1',
        externalSystem: 'github',
        source: 'example/web',
        revision: '41',
        next: 'after:page-2',
      },
    ]);
    expect(run.output).toMatchObject({
      kind: 'github',
      source: 'example/web',
      ok: true,
      batch: 2,
      resumed: true,
      saved: true,
      drained: false,
      nextCursor: 'after:page-2',
    });
  });

  it('ends the pass with the batch that reaches the end of the listing [AUTO-R57]', async () => {
    const run = await execute(intakeSource, {
      input: { projectId: 'proj_1', source: github('web') },
      mode: 'mock',
      store: standIns(),
      bench: { mocks: { position: position('page-9', 5) } },
    });
    expect(saves(run.effects)).toEqual([
      expect.objectContaining({ revision: '41', next: '' }),
    ]);
    expect(run.output).toMatchObject({
      ok: true,
      batch: 5,
      saved: true,
      drained: true,
      truncated: false,
      nextCursor: null,
    });
  });

  it('keeps a source under owner/repo or organization/project, the names an existing pass was saved under [AUTO-R58]', async () => {
    for (const [source, key] of [
      [
        { kind: 'github', owner: 'tale-project', repo: 'tale' },
        { externalSystem: 'github', source: 'tale-project/tale' },
      ],
      [
        { kind: 'glitchtip', organization: 'tale', project: 'web' },
        { externalSystem: 'glitchtip', source: 'tale/web' },
      ],
    ] as const) {
      const run = await execute(intakeSource, {
        input: { projectId: 'proj_1', source },
        mode: 'mock',
        store: standIns(),
      });
      expect(
        run.trace.find((entry) => entry.node === 'position')?.input,
      ).toEqual({ projectId: 'proj_1', ...key });
      expect(saves(run.effects)).toEqual([expect.objectContaining(key)]);
    }
  });

  it('saves nothing when the import fails, so the same batch is imported again [AUTO-R59]', async () => {
    const run = await execute(intakeSource, {
      input: { projectId: 'proj_1', source: github('gone') },
      mode: 'mock',
      store: standIns(),
      bench: { mocks: { position: position('page-2', 2) } },
    });
    expect(run.status).toBe('success');
    expect(run.trace.find((entry) => entry.node === 'github')?.status).toBe(
      'error',
    );
    expect(saves(run.effects)).toEqual([]);
    expect(run.output).toEqual({
      kind: 'github',
      source: 'example/gone',
      ok: false,
      error: 'import_failed',
      batch: 2,
      resumed: true,
      restarted: false,
      saved: false,
      conflict: false,
      drained: false,
    });
  });

  it('reports a save another run overtook as not saved [AUTO-R61]', async () => {
    const run = await execute(intakeSource, {
      input: { projectId: 'proj_1', source: github('web') },
      mode: 'mock',
      store: standIns(),
      bench: {
        mocks: {
          position: position('page-2', 2),
          progress: {
            saved: false,
            drained: false,
            batch: 3,
            conflict: true,
            revision: '43',
          },
        },
      },
    });
    expect(saves(run.effects)).toEqual([
      expect.objectContaining({ revision: '41', next: 'after:page-2' }),
    ]);
    expect(run.output).toMatchObject({
      ok: true,
      batch: 2,
      saved: false,
      conflict: true,
      drained: false,
    });
  });

  it('asks the importers only for the inputs they took when they first shipped [AUTO-R62]', () => {
    const calls = intakeSource.nodes.filter(
      (node) => node.type === 'subautomation',
    );
    expect(calls.map((node) => node.automation)).toEqual([
      'github-import-issues',
      'glitchtip-import-issues',
    ]);
    for (const node of calls) {
      const first = FIRST_SHIPPED_INPUTS[node.automation ?? ''] ?? [];
      expect(first).not.toEqual([]);
      for (const key of Object.keys(node.input ?? {})) {
        expect(first).toContain(key);
      }
    }
  });

  it('runs the shipped importers it calls [AUTO-R62]', async () => {
    const store = storeWith(githubImporter, glitchtipImporter);
    for (const source of [
      github('web'),
      { kind: 'glitchtip', organization: 'example', project: 'web' },
    ]) {
      const run = await execute(intakeSource, {
        input: { projectId: 'proj_1', source },
        mode: 'mock',
        store,
      });
      expect(run.status).toBe('success');
      expect(run.output).toMatchObject({
        kind: source.kind,
        ok: true,
        imported: 1,
        created: 1,
        saved: true,
        drained: true,
      });
      expect(
        run.effects.map((effect) => `${effect.node} ${effect.connector}`),
      ).toEqual(
        expect.arrayContaining([
          `${source.kind}/tasks task.upsert_issues`,
          'progress task.save_import_cursor',
        ]),
      );
    }
  });
});

describe('the intake of a list of issue sources', () => {
  it('fails as a whole when a position cannot be read, which no source can import past [AUTO-R60]', async () => {
    const single = await execute(intakeSource, {
      input: { projectId: 'proj_1', source: github('web') },
      mode: 'mock',
      store: standIns(),
      bench: { failures: { position: 'Project not found' } },
    });
    expect(single.status).toBe('error');
    expect(single.error?.nodeId).toBe('position');
    expect(saves(single.effects)).toEqual([]);

    const unreadable: Automation = {
      ...intakeSource,
      nodes: intakeSource.nodes.map((node) =>
        node.id === 'position'
          ? {
              id: 'position',
              type: 'transform',
              code: "throw new Error('Project not found');",
            }
          : node,
      ),
    };
    const store = memoryStore();
    for (const document of [intake, unreadable, standIn(githubImporter)]) {
      store.save(document.name, document);
    }
    const listed = await execute(intake, {
      input: { projectId: 'proj_1', sources: [github('web'), github('api')] },
      mode: 'mock',
      store,
    });
    expect(listed.status).toBe('error');
    expect(listed.error?.nodeId).toBe('sources');
    expect(saves(listed.effects)).toEqual([]);
  });

  it('imports and saves every other source when one fails, and reports each in the order listed [AUTO-R60]', async () => {
    const run = await execute(intake, {
      input: {
        projectId: 'proj_1',
        sources: [
          github('web'),
          github('gone'),
          { kind: 'glitchtip', organization: 'example', project: 'web' },
        ],
      },
      mode: 'mock',
      store: standIns(),
    });
    expect(run.status).toBe('success');
    expect(saves(run.effects)).toEqual([
      expect.objectContaining({
        externalSystem: 'github',
        source: 'example/web',
      }),
      expect.objectContaining({
        externalSystem: 'glitchtip',
        source: 'example/web',
      }),
    ]);
    expect(run.output).toMatchObject({
      sources: [
        { kind: 'github', source: 'example/web', ok: true, saved: true },
        {
          kind: 'github',
          source: 'example/gone',
          ok: false,
          error: 'import_failed',
          saved: false,
        },
        { kind: 'glitchtip', source: 'example/web', ok: true, saved: true },
      ],
    });
  });
});
