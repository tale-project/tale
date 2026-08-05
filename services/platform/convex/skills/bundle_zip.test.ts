// @vitest-environment node

import { ConvexError } from 'convex/values';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_FILES,
} from '../../lib/shared/schemas/skills';
import { parseSkillBundleZip } from './bundle_zip';

function skillMd(fields: Record<string, string>, body = 'Body.\n'): string {
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${frontmatter}\n---\n\n${body}`;
}

const VALID_SKILL_MD = skillMd({
  name: 'invoice-audit',
  description: 'How we audit an invoice.',
});

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function codeOf(err: unknown): string | undefined {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      return String((data as { code: unknown }).code);
    }
  }
  return undefined;
}

async function expectRefusal(buf: Buffer, code: string): Promise<void> {
  try {
    await parseSkillBundleZip(buf);
    expect.unreachable(`expected refusal ${code}`);
  } catch (err) {
    expect(codeOf(err)).toBe(code);
  }
}

describe('parseSkillBundleZip', () => {
  it('decodes a flat bundle, SKILL.md first, assets in path order', async () => {
    const parsed = await parseSkillBundleZip(
      await zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'scripts/check.py': 'print(1)\n',
        'reference.md': 'ref\n',
      }),
    );

    expect(parsed.slug).toBe('invoice-audit');
    expect(parsed.meta.description).toBe('How we audit an invoice.');
    expect(parsed.body).toBe('Body.\n');
    // SKILL.md leads; assets keep the archive's own entry order (the
    // on-disk walk sorts listings later).
    expect(parsed.files[0].relPath).toBe('SKILL.md');
    expect(parsed.files.map((f) => f.relPath)).toEqual([
      'SKILL.md',
      'scripts/check.py',
      'reference.md',
    ]);
  });

  it('strips a single wrapper folder — the shape folder zips produce', async () => {
    const parsed = await parseSkillBundleZip(
      await zipOf({
        'invoice-audit/SKILL.md': VALID_SKILL_MD,
        'invoice-audit/reference.md': 'ref\n',
      }),
    );
    expect(parsed.slug).toBe('invoice-audit');
    expect(parsed.files.map((f) => f.relPath)).toEqual([
      'SKILL.md',
      'reference.md',
    ]);
  });

  it('ignores macOS Finder metadata so the wrapper strip still fires', async () => {
    const parsed = await parseSkillBundleZip(
      await zipOf({
        'invoice-audit/SKILL.md': VALID_SKILL_MD,
        'invoice-audit/.DS_Store': 'junk',
        '__MACOSX/invoice-audit/._SKILL.md': 'resource fork',
      }),
    );
    expect(parsed.slug).toBe('invoice-audit');
    expect(parsed.files.map((f) => f.relPath)).toEqual(['SKILL.md']);
  });

  it('skips dotfiles silently, matching the bundle walk', async () => {
    const parsed = await parseSkillBundleZip(
      await zipOf({
        'SKILL.md': VALID_SKILL_MD,
        '.hidden/notes.md': 'x',
        'assets/.gitkeep': '',
      }),
    );
    expect(parsed.files.map((f) => f.relPath)).toEqual(['SKILL.md']);
  });

  it('refuses garbage, emptiness, and a missing SKILL.md', async () => {
    await expectRefusal(Buffer.from('not a zip'), 'INVALID_BUNDLE');
    await expectRefusal(await zipOf({}), 'INVALID_BUNDLE');
    await expectRefusal(
      await zipOf({ 'reference.md': 'no document' }),
      'MISSING_SKILL_MD',
    );
    // Two different top-level folders — no wrapper strip, so no root SKILL.md.
    await expectRefusal(
      await zipOf({
        'a/SKILL.md': VALID_SKILL_MD,
        'b/reference.md': 'x',
      }),
      'MISSING_SKILL_MD',
    );
  });

  it('refuses unsafe entry paths', async () => {
    // JSZip itself normalizes `../`-shaped names away at creation, so only
    // absolute and drive-letter paths reach the parser's guard from here;
    // the `..`-segment branch defends against zips other tools crafted.
    await expectRefusal(
      await zipOf({ 'SKILL.md': VALID_SKILL_MD, '/etc/passwd': 'x' }),
      'INVALID_BUNDLE',
    );
    await expectRefusal(
      await zipOf({ 'SKILL.md': VALID_SKILL_MD, 'C:/windows.md': 'x' }),
      'INVALID_BUNDLE',
    );
  });

  it('refuses a rejected frontmatter and a reserved or mismatched slug', async () => {
    await expectRefusal(
      await zipOf({ 'SKILL.md': '# no frontmatter\n' }),
      'INVALID_SKILL_MD',
    );
    await expectRefusal(
      await zipOf({
        'SKILL.md': skillMd({ name: 'claude', description: 'Sneaky.' }),
      }),
      'INVALID_SKILL_MD',
    );
    await expectRefusal(
      await zipOf({
        'SKILL.md': skillMd({
          name: 'ok',
          description: 'Private without owner.',
          visibility: 'private',
        }),
      }),
      'INVALID_SKILL_MD',
    );
  });

  it('enforces the entry and byte caps', async () => {
    const many: Record<string, string> = { 'SKILL.md': VALID_SKILL_MD };
    for (let i = 0; i <= MAX_SKILL_BUNDLE_FILES; i += 1) {
      many[`assets/file-${i}.txt`] = 'x';
    }
    await expectRefusal(await zipOf(many), 'INVALID_BUNDLE');

    await expectRefusal(
      await zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'big.bin': Buffer.alloc(MAX_SKILL_BUNDLE_FILE_BYTES + 1),
      }),
      'FILE_TOO_LARGE',
    );
  });

  it('defaults an unmarked bundle to org visibility', async () => {
    const unmarked = await parseSkillBundleZip(
      await zipOf({ 'SKILL.md': VALID_SKILL_MD }),
    );
    expect(unmarked.meta.visibility).toBe('org');
  });
});
