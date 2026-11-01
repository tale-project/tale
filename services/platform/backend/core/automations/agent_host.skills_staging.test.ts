// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MAX_SKILL_BUNDLE_FILE_BYTES } from '@tale/shared/schemas/skills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  stageFiles,
  type StageItem,
} from '../../../../sandbox-runtime/daemon/src/file-ops.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from '../../../../sandbox-runtime/daemon/src/protocol.ts';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { SkillViewer } from '../../../lib/skills/visibility';
import type { ActionCtx } from '../lib/ctx';
import { STAGE_BODY_BUDGET_BYTES } from '../node_only/sandbox/helpers/session_client';
import { readSkillBundleForViewer } from '../skills/file_actions';
import { SkillUnavailableError } from '../skills/skill_unavailable_error';
import { stageSkillBundle, stageWorkflowSkills } from './agent_host';

// Exercise the real parser, file reader, visibility gate and signed staging
// client. Only the org lookup and the sandbox's HTTP response are controlled.
const ORG_A = 'A'.repeat(32);
const ORG_B = 'B'.repeat(32);
const SESSION = 'skill-review:session';
const orgViewer: SkillViewer = { kind: 'org' };
let configRoot: string;
let staged: Array<{ path: string; contentBase64: string }>;
let skipStage: boolean;

const sandboxFetch = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'GET') {
    expect(url).toContain(
      `/v1/sessions/${encodeURIComponent(SESSION)}/files?path=`,
    );
    return Response.json({
      entries: [{ name: 'SKILL.md', type: 'file', size: 1, mtimeMs: 0 }],
    });
  }
  expect(url).toBe(
    `http://skill-review.invalid/v1/sessions/${encodeURIComponent(SESSION)}/files/stage`,
  );
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('x-tale-sandbox-signature')).toMatch(
    /^[a-f0-9]{64}$/,
  );
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a serialized staging request');
  }
  const body = JSON.parse(init.body) as {
    files: Array<{ path: string; contentBase64?: string; sourceId?: string }>;
    replaceRoots?: string[];
  };
  if (body.replaceRoots !== undefined)
    return Response.json({ staged: [], skipped: [], reconciled: true });
  if (body.files.every((file) => file.contentBase64 === undefined)) {
    return Response.json({
      staged: [],
      skipped: body.files.map((file) => ({
        path: file.path,
        reason: 'no_source',
      })),
    });
  }
  for (const file of body.files) {
    if (file.contentBase64 !== undefined)
      staged.push({ path: file.path, contentBase64: file.contentBase64 });
  }
  return Response.json(
    skipStage
      ? {
          staged: [],
          skipped: body.files.map((file) => ({
            path: file.path,
            reason: 'fixture write refusal',
          })),
        }
      : {
          staged: body.files.map((file) => ({ path: file.path, bytes: 1 })),
          skipped: [],
        },
  );
});

const runQuery = vi.fn(
  async (
    ref: unknown,
    args: {
      model: string;
      where: Array<{ field: string; value: string }>;
    },
  ) => {
    expect(functionRefName(ref)).toBe(
      '_reference/childComponent/betterAuth/adapter/findOne',
    );
    expect(args.model).toBe('organization');
    const id = args.where.find((entry) => entry.field === '_id')?.value;
    if (id === ORG_A) return { slug: 'org-a' };
    if (id === ORG_B) return { slug: 'org-b' };
    return null;
  },
);

const runAction = vi.fn(
  async (
    ref: unknown,
    args: Parameters<typeof readSkillBundleForViewer>[0],
  ) => {
    expect(functionRefName(ref)).toBe('skills/file_actions:readSkillBundle');
    return readSkillBundleForViewer(args);
  },
);

const ctx = { runQuery, runAction } as unknown as ActionCtx;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-skill-staging-'));
  vi.stubEnv('TALE_CONFIG_DIR', configRoot);
  vi.stubEnv('SANDBOX_URL', 'http://skill-review.invalid');
  vi.stubEnv('SANDBOX_TOKEN', randomBytes(32).toString('hex'));
  vi.stubGlobal('fetch', sandboxFetch);
  staged = [];
  skipStage = false;
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(configRoot, { recursive: true, force: true });
});

async function seed(
  org: string,
  slug: string,
  description: string,
  extra = '',
): Promise<string> {
  const dir = path.join(configRoot, org, 'skills', slug);
  await mkdir(dir, { recursive: true });
  const body = `---\nname: ${slug}\ndescription: ${JSON.stringify(description)}\n${extra}---\n\nWrite the requested report.\n`;
  await writeFile(path.join(dir, 'SKILL.md'), body);
  return body;
}

describe('equipped skill staging with real bundles', () => {
  it('stages the same authorized bytes it describes and keeps task skill order', async () => {
    const report = await seed('org-a', 'report', 'Prepare reports.');
    const release = await seed(
      'org-a',
      'release',
      'Prepare a release.',
      'disable-model-invocation: true\n',
    );
    await mkdir(path.join(configRoot, 'org-a/skills/report/assets'));
    await writeFile(
      path.join(configRoot, 'org-a/skills/report/assets/template.md'),
      'Report template.',
    );

    // Bundle reads and uploads run concurrently. Force the second equipped
    // skill to upload first without making prompt order depend on that timing.
    const reportUploaded = Promise.withResolvers<void>();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return sandboxFetch(url, init);
      if (typeof init?.body !== 'string')
        throw new Error('Expected a serialized staging request');
      const body = JSON.parse(init.body) as {
        files: Array<{ path: string; contentBase64?: string }>;
      };
      const uploading = (slug: string) =>
        body.files.some(
          (file) =>
            file.path === `workspace/.tale/skills/${slug}/SKILL.md` &&
            file.contentBase64 !== undefined,
        );
      if (uploading('release')) await reportUploaded.promise;
      const response = await sandboxFetch(url, init);
      if (uploading('report')) reportUploaded.resolve();
      return response;
    });

    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['release', 'report'],
      orgViewer,
    );

    expect(prompt.indexOf('- release:')).toBeLessThan(
      prompt.indexOf('- report:'),
    );
    expect(prompt).toContain(
      '<skill-description>Prepare reports.</skill-description>',
    );
    expect(prompt).toContain('Use it only when the task asks for it by name.');
    expect(staged).toHaveLength(3);
    expect(
      Object.fromEntries(
        staged.map((file) => [
          file.path,
          Buffer.from(file.contentBase64, 'base64').toString(),
        ]),
      ),
    ).toEqual({
      'workspace/.tale/skills/release/SKILL.md': release,
      'workspace/.tale/skills/report/SKILL.md': report,
      'workspace/.tale/skills/report/assets/template.md': 'Report template.',
    });
  });

  it('keeps identically named skills inside their organization', async () => {
    await seed('org-a', 'report', 'Organization A only.');
    await seed('org-b', 'report', 'Organization B only.');
    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_B,
      SESSION,
      ['report'],
      orgViewer,
    );
    expect(prompt).toContain('Organization B only.');
    expect(prompt).not.toContain('Organization A only.');
    expect(Buffer.from(staged[0].contentBase64, 'base64').toString()).toContain(
      'Organization B only.',
    );
  });

  it('describes a team skill only in an overlapping project scope', async () => {
    await seed(
      'org-a',
      'team-report',
      'Red team report.',
      'visibility: team\nteams: [red]\n',
    );
    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['team-report'],
      { kind: 'project', teamIds: ['red'] },
    );
    expect(prompt).toContain('Red team report.');
    expect(sandboxFetch).toHaveBeenCalledTimes(4); // root probe, hash probe, missing bytes, prune
  });

  it.each<SkillViewer>([orgViewer, { kind: 'project', teamIds: ['blue'] }])(
    'refuses team or private descriptions outside the run scope: %j',
    async (viewer) => {
      await seed(
        'org-a',
        'team-report',
        'Hidden team report.',
        'visibility: team\nteams: [red]\n',
      );
      await seed(
        'org-a',
        'private-report',
        'Hidden private report.',
        'visibility: private\nowner: author\n',
      );
      for (const slug of ['team-report', 'private-report']) {
        await expect(
          stageWorkflowSkills(ctx, ORG_A, SESSION, [slug], viewer),
        ).rejects.toBeInstanceOf(SkillUnavailableError);
      }
      expect(sandboxFetch).not.toHaveBeenCalled();
    },
  );

  it('fails before staging a malformed or missing bundle', async () => {
    await seed('org-a', 'broken', 'Initially valid.');
    await writeFile(
      path.join(configRoot, 'org-a/skills/broken/SKILL.md'),
      'no frontmatter',
    );
    await expect(
      stageWorkflowSkills(ctx, ORG_A, SESSION, ['broken'], orgViewer),
    ).rejects.toMatchObject({ data: { code: 'SKILL_MALFORMED' } });
    await expect(
      stageWorkflowSkills(ctx, ORG_A, SESSION, ['missing'], orgViewer),
    ).rejects.toBeInstanceOf(SkillUnavailableError);
    expect(sandboxFetch).not.toHaveBeenCalled();
  });

  it('returns no prompt when the sandbox refused a file', async () => {
    await seed('org-a', 'report', 'Prepare reports.');
    skipStage = true;
    await expect(
      stageWorkflowSkills(ctx, ORG_A, SESSION, ['report'], orgViewer),
    ).rejects.toThrow('fixture write refusal');
  });

  it('does no lookup or staging when nothing is equipped', async () => {
    expect(await stageWorkflowSkills(ctx, ORG_A, SESSION, [], orgViewer)).toBe(
      '',
    );
    expect(runQuery).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
    expect(sandboxFetch).not.toHaveBeenCalled();
  });
});

// REGRESSION (#5177): the upload takes a skill file of up to 4 MiB, but the
// staging client threw on one over ~1.1 MiB and the sandbox runtime refused
// one over 1 MiB, so a skill with a 1.2 MB template could never run.
describe('a skill file between 1 MiB and the upload’s cap', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'tale-skill-runtime-'));
    vi.stubEnv('TALE_WORKSPACE_ROOT', workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /** The deck skill: a 1.2 MB template, and a file of the largest size. */
  async function seedDeck(): Promise<Record<string, Buffer>> {
    await seed('org-a', 'deck', 'Build decks from the template.');
    await mkdir(path.join(configRoot, 'org-a/skills/deck/assets'));
    const assets = {
      'assets/template.pptx': randomBytes(1_200_000),
      'assets/largest.bin': randomBytes(MAX_SKILL_BUNDLE_FILE_BYTES),
    };
    for (const [name, bytes] of Object.entries(assets))
      await writeFile(path.join(configRoot, 'org-a/skills/deck', name), bytes);
    return assets;
  }

  /** What a staging request carries. */
  type StageBody = {
    files: StageItem[];
    replaceRoots?: string[];
    keepPaths?: string[];
  };

  it('copies it into the sandbox runtime for agent nodes, tasks and script nodes', async () => {
    const assets = await seedDeck();
    const sizes: number[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return sandboxFetch(url, init);
      if (typeof init?.body !== 'string')
        throw new Error('Expected a serialized staging request');
      const raw = init.body;
      sizes.push(Buffer.byteLength(raw));
      // The spawner's request cap, which it clamps to runnerd's.
      if (Buffer.byteLength(raw) > RUNNERD_MAX_REQUEST_BODY_BYTES)
        return Response.json({ error: 'payload_too_large' }, { status: 413 });
      const body = JSON.parse(raw) as StageBody;
      return Response.json(
        await stageFiles(body.files, {
          replaceRoots: body.replaceRoots,
          keepPaths: body.keepPaths,
        }),
      );
    });

    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['deck'],
      orgViewer,
    );

    expect(prompt).toContain('- deck:');
    for (const [name, bytes] of Object.entries(assets)) {
      const onDisk = await readFile(
        path.join(workspace, 'workspace/.tale/skills/deck', name),
      );
      expect(onDisk.equals(bytes)).toBe(true);
    }
    // Each went in a request of its own, larger than a batch may be.
    expect(sizes.filter((size) => size > STAGE_BODY_BUDGET_BYTES)).toHaveLength(
      2,
    );

    // A script node stages the same bundle where its program reads it.
    await expect(
      stageSkillBundle(ctx, ORG_A, SESSION, 'deck', 'skills/deck', orgViewer),
    ).resolves.toBe(3);
    const template = await readFile(
      path.join(workspace, 'skills/deck/assets/template.pptx'),
    );
    expect(template.equals(assets['assets/template.pptx'])).toBe(true);
  });

  it('names each file and the limit when the sandbox runtime is outdated', async () => {
    await seedDeck();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return sandboxFetch(url, init);
      if (typeof init?.body !== 'string')
        throw new Error('Expected a serialized staging request');
      const body = JSON.parse(init.body) as StageBody;
      if (body.files.every((file) => file.contentBase64 === undefined))
        return sandboxFetch(url, init);
      // A runtime from before inline files could be 4 MiB takes 1 MiB.
      const tooLarge = (file: StageItem) =>
        Buffer.byteLength(file.contentBase64 ?? '', 'base64') > 1024 * 1024;
      return Response.json({
        staged: body.files
          .filter((file) => !tooLarge(file))
          .map((file) => ({ path: file.path, bytes: 1 })),
        skipped: body.files
          .filter(tooLarge)
          .map((file) => ({ path: file.path, reason: 'too_large' })),
      });
    });

    const error = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['deck'],
      orgViewer,
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^staging skill "deck" failed: /);
    expect(message).toContain(
      'workspace/.tale/skills/deck/assets/template.pptx (1.1 MB, over the 1.0 MB an outdated sandbox runtime takes; an updated one takes 4.0 MB)',
    );
    expect(message).toContain(
      'workspace/.tale/skills/deck/assets/largest.bin (4.0 MB, over the 1.0 MB an outdated sandbox runtime takes; an updated one takes 4.0 MB)',
    );
  });
});

describe('a run whose starter may not read the agent’s own project stages only the skills that starter sees too [TASK-R82]', () => {
  // Development is shared with the dev team; Bea is in the billing team.
  const development: SkillViewer = { kind: 'project', teamIds: ['dev'] };
  const bea: SkillViewer = {
    kind: 'user',
    userId: 'bea',
    teamIds: ['billing'],
    isOrgAdmin: false,
  };

  it('leaves the team skill Bea cannot see out of the workspace and the list, and stages the organization’s', async () => {
    await seed('org-a', 'release-notes', 'Write release notes.');
    await seed(
      'org-a',
      'deploy-runbook',
      'Deploy Development.',
      'visibility: team\nteams: [dev]\n',
    );
    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['release-notes', 'deploy-runbook'],
      development,
      { alsoVisibleTo: bea },
    );
    expect(prompt).toContain('- release-notes:');
    expect(prompt).not.toContain('deploy-runbook');
    expect(staged.map((file) => file.path)).toEqual([
      'workspace/.tale/skills/release-notes/SKILL.md',
    ]);
  });

  it('stages both for a starter who sees both, as without a second viewer', async () => {
    await seed('org-a', 'release-notes', 'Write release notes.');
    await seed(
      'org-a',
      'deploy-runbook',
      'Deploy Development.',
      'visibility: team\nteams: [dev]\n',
    );
    const prompt = await stageWorkflowSkills(
      ctx,
      ORG_A,
      SESSION,
      ['release-notes', 'deploy-runbook'],
      development,
      { alsoVisibleTo: { ...bea, teamIds: ['billing', 'dev'] } },
    );
    expect(prompt).toContain('- deploy-runbook:');
    expect(staged).toHaveLength(2);
  });

  it('lists nothing when the starter sees none of them, and still refuses a skill the project cannot equip', async () => {
    await seed(
      'org-a',
      'deploy-runbook',
      'Deploy Development.',
      'visibility: team\nteams: [dev]\n',
    );
    await expect(
      stageWorkflowSkills(
        ctx,
        ORG_A,
        SESSION,
        ['deploy-runbook'],
        development,
        { alsoVisibleTo: { kind: 'org' } },
      ),
    ).resolves.toBe('');
    expect(staged).toEqual([]);
    await expect(
      stageWorkflowSkills(ctx, ORG_A, SESSION, ['no-such-skill'], development, {
        alsoVisibleTo: bea,
      }),
    ).rejects.toBeInstanceOf(SkillUnavailableError);
  });
});
