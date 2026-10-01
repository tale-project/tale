import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listSkillsForViewer } from '../../core/skills/file_actions.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { listProjectSkillSlugs } from './composer.ts';

vi.mock('../../core/skills/file_actions.ts', () => ({
  listSkillsForViewer: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug: vi.fn() }));

/** A postgres.js stand-in answering the project's team scope. */
function fakeSql(teamIds: string[] | null): Sql {
  const tag = (strings: TemplateStringsArray) =>
    Promise.resolve(
      strings.join('?').includes('FROM app.projects') ? [{ teamIds }] : [],
    );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

beforeEach(() => {
  vi.mocked(resolveOrgSlug).mockReset().mockResolvedValue('acme');
  vi.mocked(listSkillsForViewer)
    .mockReset()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the slugs are read
    .mockResolvedValue({
      skills: [{ slug: 'docx' }, { slug: 'house-style' }],
    } as unknown as Awaited<ReturnType<typeof listSkillsForViewer>>);
});

describe('listProjectSkillSlugs — what the project itself can equip', () => {
  it('lists the skills visible to the project and its teams, as a launch resolves them', async () => {
    await expect(
      listProjectSkillSlugs(fakeSql(['team-1']), {
        organizationId: 'org-1',
        projectId: 'project-1',
      }),
    ).resolves.toEqual(['docx', 'house-style']);
    expect(listSkillsForViewer).toHaveBeenCalledWith({
      orgSlug: 'acme',
      viewer: { kind: 'project', teamIds: ['team-1'] },
    });
  });

  it('lists nothing for an organization without a configuration home', async () => {
    vi.mocked(resolveOrgSlug).mockResolvedValue(null);

    await expect(
      listProjectSkillSlugs(fakeSql([]), {
        organizationId: 'org-1',
        projectId: 'project-1',
      }),
    ).resolves.toEqual([]);
    expect(listSkillsForViewer).not.toHaveBeenCalled();
  });
});
