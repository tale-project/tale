// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listSkillsForViewer,
  readSkillAssetForViewer,
  readSkillForViewer,
} from '../../core/skills/file_actions.ts';
import { prewarmLightSandbox } from './run-code.ts';
import {
  listSkillCatalog,
  runLoadSkill,
  runReadSkillFile,
  SKILL_BODY_MAX_CHARS,
} from './skills.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

vi.mock('../../core/skills/file_actions.ts', () => ({
  listSkillsForViewer: vi.fn(),
  readSkillForViewer: vi.fn(),
  readSkillAssetForViewer: vi.fn(),
}));
vi.mock('./run-code.ts', () => ({ prewarmLightSandbox: vi.fn() }));

function skill(
  overrides: Partial<{
    slug: string;
    description: string;
    body: string;
    files: { path: string; size: number }[];
    disableModelInvocation: boolean;
    origin: string;
    owner: string;
  }> = {},
) {
  return {
    slug: 'docx',
    description: 'Word documents',
    body: 'Use docx-js to build the document.',
    files: [
      { path: 'SKILL.md', size: 10 },
      { path: 'scripts/office/pack.py', size: 20 },
    ],
    visibility: 'org',
    origin: 'builtin',
    canEdit: false,
    etag: '"x"',
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prewarmLightSandbox).mockClear();
});

describe('load_skill', () => {
  it('answers the instructions and the bundle, and how to use its files from code', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
    vi.mocked(readSkillForViewer).mockResolvedValue(skill() as never);
    const { scope } = testScope();

    const result = await runLoadSkill(scope, { name: 'docx' });

    expect(readSkillForViewer).toHaveBeenCalledWith({
      orgSlug: 'acme',
      slug: 'docx',
      viewer: scope.skillViewer,
    });
    expect(result).toMatchObject({
      status: 'ok',
      name: 'docx',
      instructions: 'Use docx-js to build the document.',
      files: [
        { path: 'SKILL.md', size: 10 },
        { path: 'scripts/office/pack.py', size: 20 },
      ],
    });
    expect(JSON.stringify(result)).toContain('/agent/skills/docx/');
  });

  it('maps the skill onto the light sandbox, so a file made by its examples is still delivered', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
    vi.mocked(readSkillForViewer).mockResolvedValue(skill() as never);
    const { scope } = testScope();

    const result = await runLoadSkill(scope, { name: 'docx' });
    const usage = (result as { usage: string }).usage;

    expect(usage).toContain('python /agent/skills/docx/scripts/');
    expect(usage).toContain(
      'Save each file the user should get directly in /agent/output/',
    );
    expect(usage).toContain('Do not write into /agent/skills/docx/');
  });

  it('says a skill’s scripts cannot run where code cannot', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
    vi.mocked(readSkillForViewer).mockResolvedValue(skill() as never);
    const { scope } = testScope({
      loadout: { ...FULL_LOADOUT, runCode: false },
    });

    const usage = (
      (await runLoadSkill(scope, { name: 'docx' })) as { usage: string }
    ).usage;

    expect(usage).toContain('Code cannot run in this conversation');
    expect(usage).not.toContain('run_code');
  });

  it('starts the light sandbox early for a skill with scripts, not for one of words alone', async () => {
    const { scope } = testScope();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
    vi.mocked(readSkillForViewer).mockResolvedValueOnce(skill() as never);
    await runLoadSkill(scope, { name: 'docx' });
    expect(prewarmLightSandbox).toHaveBeenCalledWith(scope);

    vi.mocked(prewarmLightSandbox).mockClear();
    vi.mocked(readSkillForViewer).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
      skill({
        slug: 'house-style',
        files: [{ path: 'SKILL.md', size: 10 }],
      }) as never,
    );
    await runLoadSkill(scope, { name: 'house-style' });
    expect(prewarmLightSandbox).not.toHaveBeenCalled();
  });

  it('continues long instructions through read_skill_file', async () => {
    vi.mocked(readSkillForViewer).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
      skill({ body: 'x'.repeat(SKILL_BODY_MAX_CHARS + 10) }) as never,
    );
    const { scope } = testScope({
      loadout: { ...FULL_LOADOUT, runCode: false },
    });

    const result = await runLoadSkill(scope, { name: 'docx' });

    expect(result).toMatchObject({ nextOffset: SKILL_BODY_MAX_CHARS });
    expect((result as { instructions: string }).instructions.length).toBe(
      SKILL_BODY_MAX_CHARS,
    );
  });

  it('answers a skill the person cannot see as absent, and a malformed name as correctable [CHAT-R21]', async () => {
    vi.mocked(readSkillForViewer).mockResolvedValue(null);
    const { scope } = testScope();
    await expect(
      runLoadSkill(scope, { name: 'secret' }),
    ).resolves.toMatchObject({ status: 'not_found' });
    await expect(
      runLoadSkill(scope, { name: '../etc' }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
  });
});

describe('read_skill_file', () => {
  it('reads a window of a text file and says where it continues', async () => {
    vi.mocked(readSkillAssetForViewer).mockResolvedValue({
      kind: 'asset',
      path: 'reference.md',
      content: Buffer.from('a'.repeat(25_000)),
      mtimeMs: 0,
    });
    const { scope } = testScope();

    const result = await runReadSkillFile(scope, {
      name: 'pdf',
      path: 'reference.md',
    });

    expect(result).toMatchObject({
      status: 'ok',
      path: 'reference.md',
      totalChars: 25_000,
      nextOffset: 20_000,
    });
    const next = await runReadSkillFile(scope, {
      name: 'pdf',
      path: 'reference.md',
      offset: 20_000,
    });
    expect((next as { content: string }).content).toHaveLength(5_000);
    expect(next).not.toHaveProperty('nextOffset');
  });

  it('sends a binary file to run_code', async () => {
    vi.mocked(readSkillAssetForViewer).mockResolvedValue({
      kind: 'asset',
      path: 'templates/logo.png',
      content: Buffer.from([0x89, 0x50, 0x00, 0x01]),
      mtimeMs: 0,
    });
    const { scope } = testScope();
    const result = await runReadSkillFile(scope, {
      name: 'pptx',
      path: 'templates/logo.png',
    });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(JSON.stringify(result)).toContain('/agent/skills/pptx/');
  });

  it('tells a missing skill from a missing file', async () => {
    const { scope } = testScope();
    vi.mocked(readSkillAssetForViewer).mockResolvedValueOnce({
      kind: 'no-skill',
    });
    await expect(
      runReadSkillFile(scope, { name: 'gone', path: 'a.md' }),
    ).resolves.toMatchObject({ status: 'not_found' });
    vi.mocked(readSkillAssetForViewer).mockResolvedValueOnce({
      kind: 'no-file',
    });
    const result = await runReadSkillFile(scope, { name: 'pdf', path: 'b.md' });
    expect(JSON.stringify(result)).toContain('has no file');
  });

  it('reads the one bundled file a path names in another case', async () => {
    const { scope } = testScope();
    vi.mocked(readSkillAssetForViewer)
      .mockReset()
      .mockResolvedValueOnce({ kind: 'no-file' })
      .mockResolvedValueOnce({
        kind: 'asset',
        path: 'forms.md',
        content: Buffer.from('# Filling a form'),
        mtimeMs: 0,
      });
    vi.mocked(readSkillForViewer).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
      skill({
        slug: 'pdf',
        files: [
          { path: 'SKILL.md', size: 10 },
          { path: 'forms.md', size: 16 },
        ],
      }) as never,
    );

    const result = await runReadSkillFile(scope, {
      name: 'pdf',
      path: 'FORMS.md',
    });

    expect(result).toMatchObject({
      status: 'ok',
      path: 'forms.md',
      content: '# Filling a form',
    });
    expect(readSkillAssetForViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'forms.md' }),
    );
  });

  it('does not guess between two files that differ in case only', async () => {
    const { scope } = testScope();
    vi.mocked(readSkillAssetForViewer)
      .mockReset()
      .mockResolvedValue({ kind: 'no-file' });
    vi.mocked(readSkillForViewer).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view fields the tool reads
      skill({
        slug: 'pdf',
        files: [
          { path: 'Notes.md', size: 1 },
          { path: 'notes.MD', size: 1 },
        ],
      }) as never,
    );

    const result = await runReadSkillFile(scope, {
      name: 'pdf',
      path: 'NOTES.md',
    });

    expect(result).toMatchObject({ status: 'not_found' });
    expect(readSkillAssetForViewer).toHaveBeenCalledTimes(1);
  });
});

describe('listSkillCatalog', () => {
  it('lists the viewer’s skills by name, with their explicit-only flag and not who made them', async () => {
    vi.mocked(listSkillsForViewer).mockResolvedValue({
      skills: [
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the summary fields the catalog reads
        skill({
          slug: 'pptx',
          description: 'Slides',
          origin: 'member',
          owner: 'user_ada',
        }) as never,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the summary fields the catalog reads
        skill({
          slug: 'audit',
          description: '',
          disableModelInvocation: true,
        }) as never,
      ],
      failures: [],
    });
    await expect(
      listSkillCatalog('acme', testScope().scope.skillViewer),
    ).resolves.toEqual([
      { slug: 'audit', explicitOnly: true },
      { slug: 'pptx', description: 'Slides' },
    ]);
  });

  it('lists nothing when the library cannot be read', async () => {
    vi.mocked(listSkillsForViewer).mockRejectedValue(new Error('EIO'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      listSkillCatalog('acme', testScope().scope.skillViewer),
    ).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('an equipped list narrows the skills a turn reaches', () => {
  const EQUIPPED = ['docx'];

  it('lists, loads and reads only what the agent is equipped with', async () => {
    vi.mocked(listSkillsForViewer).mockResolvedValue({
      skills: [skill({ slug: 'docx' }), skill({ slug: 'budget-review' })],
    } as never);
    await expect(
      listSkillCatalog('acme', { kind: 'project', teamIds: [] }, EQUIPPED).then(
        (entries) => entries.map((entry) => entry.slug),
      ),
    ).resolves.toEqual(['docx']);

    const { scope } = testScope({ skillAllowlist: EQUIPPED });
    vi.mocked(readSkillForViewer).mockImplementation(({ slug }) =>
      Promise.resolve(skill({ slug }) as never),
    );
    await expect(runLoadSkill(scope, { name: 'docx' })).resolves.toMatchObject({
      status: 'ok',
    });
    // Visible to the viewer, yet not the agent's: answered as absent, and the
    // library is not even asked.
    vi.mocked(readSkillForViewer).mockClear();
    vi.mocked(readSkillAssetForViewer).mockClear();
    await expect(
      runLoadSkill(scope, { name: 'budget-review' }),
    ).resolves.toMatchObject({ status: 'not_found' });
    expect(readSkillForViewer).not.toHaveBeenCalled();
    await expect(
      runReadSkillFile(scope, { name: 'budget-review', path: 'SKILL.md' }),
    ).resolves.toMatchObject({ status: 'not_found' });
    expect(readSkillAssetForViewer).not.toHaveBeenCalled();
  });
});
