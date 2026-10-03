// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { SkillViewer } from '../../../lib/skills/visibility';
import type { ActionCtx } from '../lib/ctx';
import { readSkillBundleForViewer } from '../skills/file_actions';
import { SkillUnavailableError } from '../skills/skill_unavailable_error';
import { stageWorkflowSkills } from './agent_host';

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
    expect(staged.map((file) => file.path)).toEqual([
      'workspace/.tale/skills/release/SKILL.md',
      'workspace/.tale/skills/report/SKILL.md',
      'workspace/.tale/skills/report/assets/template.md',
    ]);
    expect(Buffer.from(staged[0].contentBase64, 'base64').toString()).toBe(
      release,
    );
    expect(Buffer.from(staged[1].contentBase64, 'base64').toString()).toBe(
      report,
    );
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
