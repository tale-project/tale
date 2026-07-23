// @vitest-environment node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { parseSkillMd } from '../../../../../lib/skills/parse';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import {
  exportPromptsToSkills,
  readPromptOrigin,
  slugifyTitle,
  type PromptTemplateRow,
} from './mapping';

// World-building imports the whole convex tree; under the fully parallel
// suite the default budget flakes, and a timed-out ritual's zombie async work
// can corrupt the file's later tests.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_4_0/30_prompts_to_skill_files';

function skillFile(root: string, orgSlug: string, slug: string): string {
  return path.join(root, orgSlug, 'skills', slug, 'SKILL.md');
}

async function readSkill(
  root: string,
  orgSlug: string,
  slug: string,
): Promise<ReturnType<typeof parseSkillMd>> {
  const file = skillFile(root, orgSlug, slug);
  return parseSkillMd(await readFile(file, 'utf-8'), file);
}

// Harness ritual: real fleet up, handler idempotency over migrated state,
// down restoring the seeded world (DB rows AND on-disk files) byte-for-byte,
// and the per-org ledger.
defineMigrationTest({
  id: '0.4.0/30_prompts_to_skill_files',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 holds no prompts: the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    // Both orgs already have the domain directory; org1 additionally has a
    // hand-written skill the export must leave exactly as it is.
    for (const org of orgs) {
      await mkdir(path.join(root, org.slug, 'skills'), { recursive: true });
    }
    const existing = path.join(root, orgs[0].slug, 'skills', 'house-voice');
    await mkdir(existing, { recursive: true });
    await writeFile(
      path.join(existing, 'SKILL.md'),
      [
        '---',
        'name: house-voice',
        'description: The house tone of voice.',
        'visibility: org',
        '---',
        '',
        'Write plainly.',
        '',
      ].join('\n'),
      'utf-8',
    );
  },

  async seed(ctx, orgs) {
    await ctx.db.insert('promptTemplates', {
      organizationId: orgs[0].id,
      createdBy: 'user_admin',
      title: 'Weekly report',
      content: 'Summarise the week in five bullets.',
      description: 'The Monday status note.',
      scope: 'global',
      category: 'Reporting',
      tags: ['status', 'weekly'],
      usageCount: 4,
    });
    await ctx.db.insert('promptTemplates', {
      organizationId: orgs[0].id,
      createdBy: 'user_member',
      title: 'Weekly report',
      content: 'My own take.',
      scope: 'personal',
      usageCount: 1,
    });
    await ctx.db.insert('promptTemplates', {
      organizationId: orgs[0].id,
      createdBy: 'user_admin',
      title: 'Support triage',
      content: 'Classify the ticket, then propose the next action.',
      scope: 'team',
      teamId: 'team_support',
      usageCount: 2,
    });
    await ctx.db.insert('promptTemplates', {
      organizationId: orgs[0].id,
      createdBy: 'user_member',
      title: 'Abandoned draft',
      content: 'Never finished.',
      scope: 'personal',
      usageCount: 0,
      lifecycleStatus: 'trashed',
    });
    // org2 seeds nothing — the no-op path.
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const root = world.configRoot;

    // Every scope lands as a bundle, and the colliding titles get distinct,
    // deterministic slugs.
    expect(
      (await readdir(path.join(root, org1.slug, 'skills'))).sort(),
    ).toEqual([
      'house-voice',
      'support-triage',
      'weekly-report',
      'weekly-report-2',
    ]);

    // A global prompt becomes an org-visible skill carrying its body verbatim.
    const weekly = await readSkill(root, org1.slug, 'weekly-report');
    expect(weekly.meta.visibility).toBe('org');
    expect(weekly.meta.owner).toBe('user_admin');
    expect(weekly.meta.description).toBe('The Monday status note.');
    expect(weekly.meta.labels).toEqual(['Reporting', 'status', 'weekly']);
    expect(weekly.body).toBe('Summarise the week in five bullets.\n');

    // A personal prompt becomes a private skill owned by its author.
    const personal = await readSkill(root, org1.slug, 'weekly-report-2');
    expect(personal.meta.visibility).toBe('private');
    expect(personal.meta.owner).toBe('user_member');
    // With no description of its own, the title carries the summary.
    expect(personal.meta.description).toBe('Weekly report');

    // A team prompt is org-visible and remembers the team it belonged to.
    const triage = await readSkill(root, org1.slug, 'support-triage');
    expect(triage.meta.visibility).toBe('org');
    expect(readPromptOrigin(triage.meta)).toMatchObject({
      title: 'Support triage',
      scope: 'team',
      team: 'team_support',
    });

    // The soft-deleted prompt is not resurrected.
    expect(
      (await readdir(path.join(root, org1.slug, 'skills'))).includes(
        'abandoned-draft',
      ),
    ).toBe(false);

    // The org's own skill is untouched by the export.
    const house = await readSkill(root, org1.slug, 'house-voice');
    expect(house.body).toBe('Write plainly.\n');
    expect(readPromptOrigin(house.meta)).toBeNull();

    // The org with no prompts gains no bundles.
    expect(await readdir(path.join(root, org2.slug, 'skills'))).toEqual([]);

    // The prompt rows are still there — this export drains nothing.
    const rows = await world.run((ctx) =>
      ctx.db.query('promptTemplates').collect(),
    );
    expect(rows).toHaveLength(4);
  },

  cases: {
    async 'a second export writes the same bytes as the first'(world) {
      const file = skillFile(
        world.configRoot,
        world.orgs[0].slug,
        'weekly-report',
      );
      await world.applyUpOnly();
      const first = await readFile(file, 'utf-8');

      await world.applyDownOnly();
      await world.applyUpOnly();

      expect(await readFile(file, 'utf-8')).toBe(first);
    },
  },

  unit: {
    'a prompt round-trips through the skill file it becomes'() {
      const row: PromptTemplateRow = {
        _id: 'prompt_1',
        _creationTime: 1,
        organizationId: 'org_1',
        createdBy: 'user_member',
        title: 'Weekly Report!',
        content: 'Body text.',
        description: 'A summary.',
        scope: 'team',
        teamId: 'team_support',
        category: 'Reporting',
        tags: ['status'],
      };

      const [skill] = exportPromptsToSkills([row]);

      expect(skill.slug).toBe('weekly-report');
      expect(skill.body).toBe('Body text.\n');
      expect(skill.meta.visibility).toBe('org');
      expect(skill.meta.owner).toBe('user_member');
      expect(skill.meta.description).toBe('A summary.');
      // Everything a prompt row carried that a skill has no field for is
      // readable back off the file, so the export loses nothing.
      expect(readPromptOrigin(skill.meta)).toEqual({
        id: 'prompt_1',
        title: 'Weekly Report!',
        scope: 'team',
        team: 'team_support',
        category: 'Reporting',
        tags: ['status'],
      });
    },

    'scopes map onto the two visibilities'() {
      const base: PromptTemplateRow = {
        _id: 'p',
        organizationId: 'org_1',
        createdBy: 'user_1',
        title: 'T',
        content: 'C',
        scope: 'personal',
      };

      const visibilities = (['personal', 'global', 'team'] as const).map(
        (scope) =>
          exportPromptsToSkills([{ ...base, scope }])[0].meta.visibility,
      );
      expect(visibilities).toEqual(['private', 'org', 'org']);
    },

    'a private export always names an owner'() {
      const [skill] = exportPromptsToSkills([
        {
          _id: 'p',
          organizationId: 'org_1',
          createdBy: 'user_1',
          title: 'T',
          content: 'C',
          scope: 'personal',
        },
      ]);
      // A private skill with no owner would be readable by nobody, and the
      // frontmatter schema refuses one.
      expect(skill.meta.owner).toBe('user_1');
    },

    'titles reduce to directory-safe slugs'() {
      expect(slugifyTitle('Weekly Report!')).toBe('weekly-report');
      expect(slugifyTitle('  --Spaced  Out--  ')).toBe('spaced-out');
      expect(slugifyTitle('!!!')).toBe('prompt');
      expect(slugifyTitle('Claude')).toBe('prompt');
      expect(slugifyTitle('x'.repeat(200))).toHaveLength(64);
    },

    'colliding titles get stable, distinct slugs'() {
      const rows: PromptTemplateRow[] = [1, 2, 3].map((n) => ({
        _id: `p${n}`,
        _creationTime: n,
        organizationId: 'org_1',
        createdBy: 'user_1',
        title: 'Weekly report',
        content: `Body ${n}`,
        scope: 'global',
      }));

      expect(exportPromptsToSkills(rows).map((s) => s.slug)).toEqual([
        'weekly-report',
        'weekly-report-2',
        'weekly-report-3',
      ]);
      // Row order out of the database must not change the assignment.
      expect(
        exportPromptsToSkills(rows.toReversed()).map((s) => s.slug),
      ).toEqual(['weekly-report', 'weekly-report-2', 'weekly-report-3']);
    },

    'soft-deleted prompts are not exported'() {
      const base: PromptTemplateRow = {
        _id: 'p',
        organizationId: 'org_1',
        createdBy: 'user_1',
        title: 'T',
        content: 'C',
        scope: 'global',
      };

      expect(
        exportPromptsToSkills([{ ...base, lifecycleStatus: 'active' }]),
      ).toHaveLength(1);
      expect(exportPromptsToSkills([base])).toHaveLength(1);
      for (const status of ['trashed', 'expired', 'deleted'] as const) {
        expect(
          exportPromptsToSkills([{ ...base, lifecycleStatus: status }]),
        ).toHaveLength(0);
      }
    },

    'a skill that was never a prompt has no origin'() {
      expect(
        readPromptOrigin({
          name: 'house-voice',
          description: 'x',
          visibility: 'org',
          extra: {},
        }),
      ).toBeNull();
      expect(
        readPromptOrigin({
          name: 'house-voice',
          description: 'x',
          visibility: 'org',
          metadata: { prompt: 'not an object' },
          extra: {},
        }),
      ).toBeNull();
    },
  },
});
