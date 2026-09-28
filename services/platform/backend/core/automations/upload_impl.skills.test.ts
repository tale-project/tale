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
): UploadHost & { cleaned: string[] } {
  const cleaned: string[] = [];
  return {
    cleaned,
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
    withSkillWriterLocks: async (_slugs, work) =>
      work({ assertTeamsAssignable }),
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
});
