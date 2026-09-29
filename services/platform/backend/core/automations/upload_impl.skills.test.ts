// @vitest-environment node

/**
 * The skills an automation package carries obey the rules every other
 * skill write door applies: the library keeps the owner (a package cannot
 * install a skill in someone else's name), a private skill cannot be minted,
 * and a team skill may only name the organization's own teams — for a
 * non-admin, only their own. The package lane used to write carried bundles
 * verbatim, skipping all three.
 */

import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { readOrgSkill } from '../../../lib/skills/listing';
import { parseSkillMd } from '../../../lib/skills/parse';
import {
  readSkillBundleFiles,
  writeSkillBundleFiles,
} from '../skills/file_utils';
import {
  type CarriedSkillWrite,
  uploadAutomationImpl,
  type UploadHost,
  type UploadSkillWriter,
} from './upload_impl';

vi.mock('../skills/file_utils', async (importActual) => {
  const actual = await importActual<typeof import('../skills/file_utils')>();
  return {
    ...actual,
    createOrgSkillReader: vi.fn(() => ({})),
    listSkillSlugs: vi.fn(async () => []),
    readSkillBundleFiles: vi.fn(),
    writeSkillBundleFiles: vi.fn(async () => undefined),
  };
});

vi.mock('../../../lib/skills/listing', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../lib/skills/listing')>();
  return { ...actual, readOrgSkill: vi.fn(async () => null) };
});

const WORKFLOW = [
  'version: 1',
  'name: triage-flow',
  'nodes:',
  '  - id: sort',
  '    type: transform',
  '    input: {}',
  "    code: 'return 1;'",
  '',
].join('\n');
const MANIFEST = 'name: Triage flow\nskills:\n  - triage\n';

function skillMd(frontmatter: string): string {
  return `---\nname: triage\ndescription: Sorts the inbox\n${frontmatter}---\n\n# Triage\n`;
}

async function pack(skill: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('workflow.yml', WORKFLOW);
  zip.file('automation.yml', MANIFEST);
  zip.file('skills/triage/SKILL.md', skill);
  return zip.generateAsync({ type: 'uint8array' });
}

function hostFor(
  bytes: Uint8Array,
  assertTeamsAssignable: UploadSkillWriter['assertTeamsAssignable'] = async () =>
    undefined,
  mayPublishOrgWide = true,
): UploadHost & { cleaned: string[]; recorded: CarriedSkillWrite[] } {
  const cleaned: string[] = [];
  const recorded: CarriedSkillWrite[] = [];
  return {
    cleaned,
    recorded,
    orgSlug: 'acme',
    userId: 'user_dev',
    isOrgAdmin: false,
    storeSave: async () => ({ name: 'triage-flow', version: 1 }),
    bindProject: async () => undefined,
    verifyStagedZip: async () => true,
    readStagedZip: async () => bytes,
    cleanupStagedZip: async (storageId) => {
      cleaned.push(storageId);
    },
    getViewerContext: async () => ({ teamIds: ['t-mine'], isOrgAdmin: false }),
    mayPublishOrgWide: async () => mayPublishOrgWide,
    withSkillWriterLocks: async (_slugs, work) =>
      work({
        assertTeamsAssignable,
        recordSkillWrite: async (write) => {
          recorded.push(write);
        },
      }),
  };
}

/** The SKILL.md the lane handed the file layer, parsed. */
function writtenMeta() {
  const call = vi.mocked(writeSkillBundleFiles).mock.calls[0];
  const doc = call?.[2].find((file) => file.path === 'SKILL.md');
  if (doc === undefined) throw new Error('no SKILL.md written');
  return parseSkillMd(doc.content.toString('utf-8'), 'SKILL.md').meta;
}

async function refusalCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof AppError) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- AppError data is untyped by design
      return (error.data as { code: string }).code;
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.mocked(readSkillBundleFiles).mockReset();
  vi.mocked(readSkillBundleFiles).mockResolvedValue(null);
  vi.mocked(writeSkillBundleFiles).mockClear();
  vi.mocked(readOrgSkill).mockResolvedValue(null);
});

describe('an automation package carrying a skill', () => {
  it('installs it as the uploader’s skill, whatever owner the package declares', async () => {
    const host = hostFor(await pack(skillMd('owner: user_mallory\n')));
    const result = await uploadAutomationImpl(host, { storageId: 's3:x' });

    expect(result).toMatchObject({
      ok: true,
      skills: [{ slug: 'triage', action: 'created' }],
    });
    expect(writtenMeta().owner).toBe('user_dev');
  });

  it('checks a team skill’s teams and installs nothing when they are refused', async () => {
    const assertTeams = vi.fn(async (teamIds: string[]) => {
      throw new AppError({
        code: 'TEAM_ACCESS_DENIED',
        message: 'Cannot assign to a team you do not belong to',
        teamIds,
      });
    });
    const host = hostFor(
      await pack(skillMd('visibility: team\nteams:\n  - t-foreign\n')),
      assertTeams,
    );

    expect(
      await refusalCode(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toBe('TEAM_ACCESS_DENIED');
    expect(assertTeams).toHaveBeenCalledWith(['t-foreign']);
    expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    expect(host.cleaned).toEqual(['s3:x']);
  });

  it('refuses to mint a private skill', async () => {
    const host = hostFor(
      await pack(skillMd('visibility: private\nowner: user_dev\n')),
    );
    // The package parser already refuses it, before any write rule runs.
    expect(
      await refusalCode(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toBe('CARRIED_SKILL_PRIVATE');
    expect(writeSkillBundleFiles).not.toHaveBeenCalled();
  });

  it('reports a re-upload of the installed skill as unchanged, not a conflict', async () => {
    const first = hostFor(await pack(skillMd('')));
    await uploadAutomationImpl(first, { storageId: 's3:x' });
    const installed = vi.mocked(writeSkillBundleFiles).mock.calls[0]?.[2];
    if (installed === undefined) throw new Error('nothing installed');
    // The library now holds the stamped bundle (owner added).
    vi.mocked(readSkillBundleFiles).mockResolvedValue(
      installed.map((file) => ({
        path: file.path,
        contentBase64: file.content.toString('base64'),
      })),
    );
    vi.mocked(readOrgSkill).mockResolvedValue({
      slug: 'triage',
      path: 'skills/triage/SKILL.md',
      ...parseSkillMd(
        installed[0]?.content.toString('utf-8') ?? '',
        'SKILL.md',
      ),
      etag: '"1"',
      updatedAt: 1,
    });
    vi.mocked(writeSkillBundleFiles).mockClear();

    const again = await uploadAutomationImpl(hostFor(await pack(skillMd(''))), {
      storageId: 's3:y',
    });
    expect(again).toMatchObject({
      ok: true,
      skills: [{ slug: 'triage', action: 'unchanged' }],
    });
    expect(writeSkillBundleFiles).not.toHaveBeenCalled();
  });

  describe('in an organization that reserves organization-wide skills', () => {
    const allowTeams = async () => undefined;

    it('refuses a carried organization-wide skill, an unmarked one included, and installs nothing', async () => {
      for (const frontmatter of ['', 'visibility: org\n']) {
        const host = hostFor(
          await pack(skillMd(frontmatter)),
          allowTeams,
          false,
        );
        expect(
          await refusalCode(uploadAutomationImpl(host, { storageId: 's3:x' })),
        ).toBe('SKILL_PUBLISH_FORBIDDEN');
        expect(host.recorded).toEqual([]);
        expect(host.cleaned).toEqual(['s3:x']);
      }
      expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    });

    it('installs a carried skill shared with the uploader’s own team, without reading the publish right', async () => {
      const host = hostFor(
        await pack(skillMd('visibility: team\nteams:\n  - t-mine\n')),
        allowTeams,
        false,
      );
      const mayPublishOrgWide = vi.fn(async () => false);
      host.mayPublishOrgWide = mayPublishOrgWide;
      expect(
        await uploadAutomationImpl(host, { storageId: 's3:x' }),
      ).toMatchObject({
        ok: true,
        skills: [{ slug: 'triage', action: 'created' }],
      });
      expect(writtenMeta().visibility).toBe('team');
      expect(mayPublishOrgWide).not.toHaveBeenCalled();
    });

    it('lets a package whose organization-wide skill is already installed as carried through unchanged', async () => {
      const first = hostFor(await pack(skillMd('')));
      await uploadAutomationImpl(first, { storageId: 's3:x' });
      const installed = vi.mocked(writeSkillBundleFiles).mock.calls[0]?.[2];
      if (installed === undefined) throw new Error('nothing installed');
      vi.mocked(readSkillBundleFiles).mockResolvedValue(
        installed.map((file) => ({
          path: file.path,
          contentBase64: file.content.toString('base64'),
        })),
      );
      vi.mocked(readOrgSkill).mockResolvedValue({
        slug: 'triage',
        path: 'skills/triage/SKILL.md',
        ...parseSkillMd(
          installed[0]?.content.toString('utf-8') ?? '',
          'SKILL.md',
        ),
        etag: '"1"',
        updatedAt: 1,
      });
      vi.mocked(writeSkillBundleFiles).mockClear();

      const again = await uploadAutomationImpl(
        hostFor(await pack(skillMd('')), allowTeams, false),
        { storageId: 's3:y' },
      );
      expect(again).toMatchObject({
        ok: true,
        skills: [{ slug: 'triage', action: 'unchanged' }],
      });
      expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    });
  });

  describe('installed ownerless, before carried skills followed the owner rule', () => {
    /** The library holds the package's SKILL.md exactly as it was carried. */
    function installVerbatim(skill: string) {
      vi.mocked(readSkillBundleFiles).mockResolvedValue([
        {
          path: 'SKILL.md',
          contentBase64: Buffer.from(skill).toString('base64'),
        },
      ]);
      vi.mocked(readOrgSkill).mockResolvedValue({
        slug: 'triage',
        path: 'skills/triage/SKILL.md',
        ...parseSkillMd(skill, 'SKILL.md'),
        etag: '"1"',
        updatedAt: 1,
      });
    }

    it('reports the same package re-uploaded by a Developer as unchanged', async () => {
      installVerbatim(skillMd(''));

      const again = await uploadAutomationImpl(
        hostFor(await pack(skillMd(''))),
        { storageId: 's3:y' },
      );
      expect(again).toMatchObject({
        ok: true,
        skills: [{ slug: 'triage', action: 'unchanged' }],
      });
      expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    });

    it('still refuses a Developer who changes it, since only an admin edits an ownerless skill', async () => {
      installVerbatim(skillMd(''));

      const run = uploadAutomationImpl(
        hostFor(await pack(skillMd('').replace('# Triage', '# Changed'))),
        { storageId: 's3:y', overwriteSkills: ['triage'] },
      );
      await expect(run).rejects.toMatchObject({
        data: {
          code: 'SKILL_CONFLICT_FORBIDDEN',
          message: expect.stringContaining(
            'you do not have permission to edit them',
          ),
        },
      });
      expect(writeSkillBundleFiles).not.toHaveBeenCalled();
    });
  });

  describe('records each installed skill for the audit log', () => {
    it('a new slug as a creation, stamped with the uploader', async () => {
      const host = hostFor(await pack(skillMd('')));
      await uploadAutomationImpl(host, { storageId: 's3:x' });

      expect(host.recorded).toHaveLength(1);
      const [write] = host.recorded;
      expect(write?.slug).toBe('triage');
      expect(write?.previous).toBeNull();
      expect(write?.current.meta.owner).toBe('user_dev');
      expect(write?.current.etag).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it('nothing for a skill the package leaves unchanged', async () => {
      const first = hostFor(await pack(skillMd('')));
      await uploadAutomationImpl(first, { storageId: 's3:x' });
      const installed = vi.mocked(writeSkillBundleFiles).mock.calls[0]?.[2];
      if (installed === undefined) throw new Error('nothing installed');
      vi.mocked(readSkillBundleFiles).mockResolvedValue(
        installed.map((file) => ({
          path: file.path,
          contentBase64: file.content.toString('base64'),
        })),
      );

      const again = hostFor(await pack(skillMd('')));
      await uploadAutomationImpl(again, { storageId: 's3:y' });
      expect(again.recorded).toEqual([]);
    });

    it('a confirmed replacement against the revision it replaced', async () => {
      const stored = skillMd('owner: user_dev\n');
      vi.mocked(readSkillBundleFiles).mockResolvedValue([
        {
          path: 'SKILL.md',
          contentBase64: Buffer.from(stored).toString('base64'),
        },
      ]);
      vi.mocked(readOrgSkill).mockResolvedValue({
        slug: 'triage',
        path: 'skills/triage/SKILL.md',
        ...parseSkillMd(stored, 'SKILL.md'),
        etag: '"stored"',
        updatedAt: 1,
      });

      const host = hostFor(
        await pack(skillMd('').replace('# Triage', '# Changed')),
      );
      await uploadAutomationImpl(host, {
        storageId: 's3:y',
        overwriteSkills: ['triage'],
      });

      expect(host.recorded).toHaveLength(1);
      expect(host.recorded[0]?.previous?.etag).toBe('"stored"');
      expect(host.recorded[0]?.current.body).toContain('# Changed');
      expect(host.recorded[0]?.filesChanged).toBe(false);
    });

    it('only once every carried bundle is on disk', async () => {
      const zip = new JSZip();
      zip.file('workflow.yml', WORKFLOW);
      zip.file(
        'automation.yml',
        'name: Triage flow\nskills:\n  - alpha\n  - triage\n',
      );
      zip.file(
        'skills/alpha/SKILL.md',
        skillMd('').replace('name: triage', 'name: alpha'),
      );
      zip.file('skills/triage/SKILL.md', skillMd(''));
      const host = hostFor(await zip.generateAsync({ type: 'uint8array' }));
      const events: string[] = [];
      vi.mocked(writeSkillBundleFiles).mockImplementation(
        async (_org, slug) => {
          events.push(`write ${slug}`);
        },
      );
      const record = host.withSkillWriterLocks.bind(host);
      host.withSkillWriterLocks = (slugs, work) =>
        record(slugs, (writer) =>
          work({
            ...writer,
            recordSkillWrite: async (write) => {
              events.push(`audit ${write.slug}`);
              await writer.recordSkillWrite(write);
            },
          }),
        );

      await uploadAutomationImpl(host, { storageId: 's3:x' });
      expect(events).toEqual([
        'write alpha',
        'write triage',
        'audit alpha',
        'audit triage',
      ]);
    });
  });

  it('keeps the audit rows of skills installed before a later install fails', async () => {
    const zip = new JSZip();
    zip.file('workflow.yml', WORKFLOW);
    zip.file(
      'automation.yml',
      'name: Triage flow\nskills:\n  - alpha\n  - triage\n',
    );
    zip.file(
      'skills/alpha/SKILL.md',
      skillMd('').replace('name: triage', 'name: alpha'),
    );
    zip.file('skills/triage/SKILL.md', skillMd(''));
    const host = hostFor(await zip.generateAsync({ type: 'uint8array' }));
    let committed = false;
    const locks = host.withSkillWriterLocks.bind(host);
    host.withSkillWriterLocks = async (slugs, work) => {
      const result = await locks(slugs, work);
      committed = true;
      return result;
    };
    vi.mocked(writeSkillBundleFiles)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    expect(
      await refusalCode(uploadAutomationImpl(host, { storageId: 's3:x' })),
    ).toBe('SKILL_WRITE_FAILED');
    // The lock's transaction commits: `alpha` is on disk, so its row stays.
    expect(committed).toBe(true);
    expect(host.recorded.map((write) => write.slug)).toEqual(['alpha']);
  });
});
