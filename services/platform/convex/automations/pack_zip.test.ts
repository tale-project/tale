// @vitest-environment node

import { ConvexError } from 'convex/values';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { collectSkillReferences, parseAutomationPackZip } from './pack_zip';

const WORKFLOW = 'name: demo\nnodes: []\n';
const MANIFEST = 'name: Demo\n';
const SKILL_MD =
  '---\nname: triage\ndescription: Sorts the inbox\n---\n\n# Triage\n';

async function buildZip(
  files: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

async function refusalCode(bytes: Uint8Array): Promise<string> {
  try {
    await parseAutomationPackZip(bytes);
  } catch (error) {
    if (error instanceof ConvexError) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError data is untyped by design
      return (error.data as { code: string }).code;
    }
    throw error;
  }
  throw new Error('expected the parser to refuse');
}

describe('parseAutomationPackZip', () => {
  it('parses a flat-root package', async () => {
    const parsed = await parseAutomationPackZip(
      await buildZip({ 'workflow.yml': WORKFLOW, 'automation.yml': MANIFEST }),
    );
    expect(parsed.document).toEqual({ name: 'workflow.yml', text: WORKFLOW });
    expect(parsed.manifest).toEqual({ name: 'automation.yml', text: MANIFEST });
    expect(parsed.skills).toEqual([]);
    expect(parsed.totalBytes).toBe(WORKFLOW.length + MANIFEST.length);
  });

  it('strips a single wrapper folder', async () => {
    const parsed = await parseAutomationPackZip(
      await buildZip({
        'my-pack/workflow.yml': WORKFLOW,
        'my-pack/automation.yml': MANIFEST,
      }),
    );
    expect(parsed.document.text).toBe(WORKFLOW);
    expect(parsed.manifest?.text).toBe(MANIFEST);
  });

  it('accepts the yaml and json document spellings', async () => {
    for (const name of ['workflow.yaml', 'workflow.json']) {
      const parsed = await parseAutomationPackZip(
        await buildZip({ [name]: WORKFLOW }),
      );
      expect(parsed.document.name).toBe(name);
    }
  });

  it('skips OS metadata and dotfile segments silently', async () => {
    const parsed = await parseAutomationPackZip(
      await buildZip({
        'workflow.yml': WORKFLOW,
        '__MACOSX/junk': 'resource fork',
        '.DS_Store': 'finder',
        '.hidden/notes.txt': 'ignored',
      }),
    );
    expect(parsed.document.text).toBe(WORKFLOW);
    expect(parsed.totalBytes).toBe(WORKFLOW.length);
  });

  it('refuses a zip without a workflow document', async () => {
    expect(
      await refusalCode(await buildZip({ 'automation.yml': MANIFEST })),
    ).toBe('MISSING_DOCUMENT');
  });

  it('refuses two workflow documents', async () => {
    expect(
      await refusalCode(
        await buildZip({ 'workflow.yml': WORKFLOW, 'workflow.yaml': WORKFLOW }),
      ),
    ).toBe('INVALID_PACK');
  });

  it('refuses bytes that are not a zip', async () => {
    expect(await refusalCode(new TextEncoder().encode('plain text'))).toBe(
      'INVALID_PACK',
    );
  });

  it('refuses an empty zip', async () => {
    expect(await refusalCode(await buildZip({}))).toBe('INVALID_PACK');
  });

  it('refuses two top-level folders', async () => {
    expect(
      await refusalCode(
        await buildZip({
          'one/workflow.yml': WORKFLOW,
          'two/workflow.yml': WORKFLOW,
        }),
      ),
    ).toBe('INVALID_PACK');
  });

  it('refuses a path-traversal entry', async () => {
    expect(
      await refusalCode(
        await buildZip({ 'workflow.yml': WORKFLOW, '../evil.txt': 'x' }),
      ),
    ).toBe('PACK_PATH_UNSAFE');
  });

  it('refuses an absolute entry path', async () => {
    const zip = new JSZip();
    zip.file('workflow.yml', WORKFLOW);
    // JSZip strips a leading slash on `file()`, so smuggle the name in raw.
    // oxlint-disable-next-line typescript/no-explicit-any -- reaching into jszip internals to build a hostile archive
    (zip as any).files['/etc/passwd'] = zip.files['workflow.yml'];
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const reparsed = await JSZip.loadAsync(bytes);
    // Some jszip versions normalise on generate; only assert when the hostile
    // name survived the round-trip.
    if ('/etc/passwd' in reparsed.files) {
      expect(await refusalCode(bytes)).toBe('PACK_PATH_UNSAFE');
    }
  });

  it('refuses more entries than the cap', async () => {
    const files: Record<string, string> = { 'workflow.yml': WORKFLOW };
    for (let i = 0; i < 501; i++) files[`skills/demo/f${i}.txt`] = 'x';
    expect(await refusalCode(await buildZip(files))).toBe('PACK_TOO_LARGE');
  });

  it('refuses one file over the per-file cap', async () => {
    expect(
      await refusalCode(
        await buildZip({
          'workflow.yml': WORKFLOW,
          'skills/triage/SKILL.md': SKILL_MD,
          'skills/triage/big.bin': new Uint8Array(2 * 1024 * 1024 + 1),
        }),
      ),
    ).toBe('PACK_FILE_TOO_LARGE');
  });

  it('refuses a package over the decompressed total cap', async () => {
    const files: Record<string, string | Uint8Array> = {
      'workflow.yml': WORKFLOW,
      'skills/triage/SKILL.md': SKILL_MD,
    };
    for (let i = 0; i < 11; i++) {
      files[`skills/triage/pad-${i}.bin`] = new Uint8Array(1_950_000);
    }
    expect(await refusalCode(await buildZip(files))).toBe('PACK_TOO_LARGE');
  });

  it('refuses an entry that is neither pack file nor skill', async () => {
    expect(
      await refusalCode(
        await buildZip({ 'workflow.yml': WORKFLOW, 'views/desk.json': '{}' }),
      ),
    ).toBe('PACK_UNEXPECTED_ENTRY');
  });

  it('skips markdown notes outside skills/ silently', async () => {
    const parsed = await parseAutomationPackZip(
      await buildZip({
        'workflow.yml': WORKFLOW,
        'README.md': 'hi',
        'PLATFORM_NOTES.md': 'historical assessment',
        'notes/design.MD': 'nested and upper-case too',
      }),
    );
    expect(parsed.document.text).toBe(WORKFLOW);
    expect(parsed.skills).toEqual([]);
    expect(parsed.totalBytes).toBe(WORKFLOW.length);
  });

  it('carries a skill bundle whole', async () => {
    const parsed = await parseAutomationPackZip(
      await buildZip({
        'workflow.yml': WORKFLOW,
        'skills/triage/SKILL.md': SKILL_MD,
        'skills/triage/scripts/run.py': 'print("hi")\n',
      }),
    );
    expect(parsed.skills).toHaveLength(1);
    const [skill] = parsed.skills;
    expect(skill?.slug).toBe('triage');
    expect(skill?.skillMdText).toBe(SKILL_MD);
    expect(skill?.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/run.py',
    ]);
  });

  it('refuses a file directly under skills/', async () => {
    expect(
      await refusalCode(
        await buildZip({ 'workflow.yml': WORKFLOW, 'skills/loose.md': 'x' }),
      ),
    ).toBe('PACK_UNEXPECTED_ENTRY');
  });

  it('refuses a skill directory without SKILL.md', async () => {
    expect(
      await refusalCode(
        await buildZip({
          'workflow.yml': WORKFLOW,
          'skills/triage/notes.md': 'x',
        }),
      ),
    ).toBe('MISSING_SKILL_FILE');
  });

  it('refuses malformed frontmatter', async () => {
    expect(
      await refusalCode(
        await buildZip({
          'workflow.yml': WORKFLOW,
          'skills/triage/SKILL.md': '# no frontmatter\n',
        }),
      ),
    ).toBe('INVALID_SKILL_MD');
  });

  it('refuses a frontmatter name that differs from the directory', async () => {
    expect(
      await refusalCode(
        await buildZip({
          'workflow.yml': WORKFLOW,
          'skills/other/SKILL.md': SKILL_MD,
        }),
      ),
    ).toBe('SKILL_NAME_MISMATCH');
  });

  it('refuses an invalid or reserved skill directory name', async () => {
    for (const slug of ['Upper', 'claude']) {
      expect(
        await refusalCode(
          await buildZip({
            'workflow.yml': WORKFLOW,
            [`skills/${slug}/SKILL.md`]: SKILL_MD,
          }),
        ),
      ).toBe('INVALID_SKILL_SLUG');
    }
  });

  it('refuses a carried skill that declares itself private', async () => {
    const privateMd =
      '---\nname: triage\ndescription: Mine\nvisibility: private\nowner: user_1\n---\nbody\n';
    expect(
      await refusalCode(
        await buildZip({
          'workflow.yml': WORKFLOW,
          'skills/triage/SKILL.md': privateMd,
        }),
      ),
    ).toBe('CARRIED_SKILL_PRIVATE');
  });
});

describe('collectSkillReferences', () => {
  it('collects agent skills and script skills, deduped and sorted', () => {
    expect(
      collectSkillReferences({
        name: 'demo',
        nodes: [
          { id: 'a', type: 'agent', skills: ['zeta', 'alpha'] },
          { id: 'b', type: 'sandbox.run_script', input: { skill: 'alpha' } },
          { id: 'c', type: 'transform', code: 'return 1;' },
        ],
      }),
    ).toEqual(['alpha', 'zeta']);
  });

  it('skips templated references and non-strings', () => {
    expect(
      collectSkillReferences({
        nodes: [
          { id: 'a', type: 'agent', skills: ['{{ inputs.skill }}', 7, ''] },
          { id: 'b', type: 'sandbox.run_script', input: { skill: '{{ x }}' } },
        ],
      }),
    ).toEqual([]);
  });

  it('reads nothing from a shapeless document', () => {
    expect(collectSkillReferences(null)).toEqual([]);
    expect(collectSkillReferences({ nodes: 'nope' })).toEqual([]);
  });
});
