// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same harness as file_actions.test.ts: identity builders so each action is a
// plain `{ handler }` driven against a real temporary config tree.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

// oxlint-disable-next-line typescript/no-explicit-any -- builders mocked to identity (third-party gap per AGENTS.md)
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-agent-history-'));
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

async function load(name: string): Promise<Handler> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    Handler
  >;
  return mod[name];
}

const ORG = 'org-history';
const OWNER = { viewerUserId: 'user_owner', isOrgAdmin: false };

async function seedAgent(slug: string, displayName: string): Promise<void> {
  const dir = path.join(configRoot, ORG, 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${slug}.yml`),
    [
      `name: ${slug}`,
      `display-name: ${displayName}`,
      'visibility: private',
      `owner: ${OWNER.viewerUserId}`,
      '',
    ].join('\n'),
  );
}

describe('agent history actions', () => {
  it('lists nothing for a never-edited agent, then one entry per save', async () => {
    await seedAgent('helper', 'Helper');
    const listHistory = await load('listHistory');
    const saveAgent = await load('saveAgent');

    await expect(
      listHistory.handler(undefined, {
        orgSlug: ORG,
        slug: 'helper',
        ...OWNER,
      }),
    ).resolves.toEqual([]);

    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper v2',
      ...OWNER,
    });
    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper v3',
      ...OWNER,
    });

    const trail = await listHistory.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });
    expect(trail).toHaveLength(2);
    // Newest first.
    expect(trail[0].savedAt).toBeGreaterThanOrEqual(trail[1].savedAt);
  });

  it('restores a snapshot additively (the replaced version joins the trail)', async () => {
    await seedAgent('helper', 'Original');
    const listHistory = await load('listHistory');
    const saveAgent = await load('saveAgent');
    const restoreFromHistory = await load('restoreFromHistory');
    const readAgent = await load('readAgent');

    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Renamed',
      ...OWNER,
    });
    const [snapshot] = await listHistory.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });

    const restored = await restoreFromHistory.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      entry: snapshot.entry,
      ...OWNER,
    });
    expect(restored.displayName).toBe('Original');

    const current = await readAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });
    expect(current?.displayName).toBe('Original');

    // The pre-restore version ("Renamed") is now itself in the trail.
    const trail = await listHistory.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });
    expect(trail.length).toBe(2);
  });

  it('refuses a restore for a non-editor and a missing entry', async () => {
    await seedAgent('helper', 'Helper');
    const saveAgent = await load('saveAgent');
    const listHistory = await load('listHistory');
    const restoreFromHistory = await load('restoreFromHistory');

    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper v2',
      ...OWNER,
    });
    const [snapshot] = await listHistory.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });

    // A private agent is invisible to another member: no history, no restore.
    const outsider = { viewerUserId: 'user_other', isOrgAdmin: false };
    await expect(
      listHistory.handler(undefined, {
        orgSlug: ORG,
        slug: 'helper',
        ...outsider,
      }),
    ).resolves.toEqual([]);
    await expect(
      restoreFromHistory.handler(undefined, {
        orgSlug: ORG,
        slug: 'helper',
        entry: snapshot.entry,
        ...outsider,
      }),
    ).rejects.toThrow(ConvexError);

    await expect(
      restoreFromHistory.handler(undefined, {
        orgSlug: ORG,
        slug: 'helper',
        entry: '1000000000000-deadbeef.yml',
        ...OWNER,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it('clears a narrowing with null and keeps it when the field is absent', async () => {
    await seedAgent('helper', 'Helper');
    const saveAgent = await load('saveAgent');
    const readAgent = await load('readAgent');

    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper',
      tools: ['automation.billing/dunning'],
      skills: [],
      ...OWNER,
    });

    // Absent = keep as-is.
    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper',
      ...OWNER,
    });
    let doc = await readAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });
    expect(doc?.tools).toEqual(['automation.billing/dunning']);
    expect(doc?.skills).toEqual([]);

    // Null = clear the narrowing (list absent again).
    await saveAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      displayName: 'Helper',
      tools: null,
      skills: null,
      ...OWNER,
    });
    doc = await readAgent.handler(undefined, {
      orgSlug: ORG,
      slug: 'helper',
      ...OWNER,
    });
    expect(doc?.tools).toBeUndefined();
    expect(doc?.skills).toBeUndefined();
  });
});
