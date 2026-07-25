// Unit gate for the per-connector skill staging (ported from the legacy
// backend): the SKILL.md tells the agent which operations exist (with their
// parameters), that writes are not callable from this agent, and how to react
// to blockers; staging reconciles stale `integration-*` dirs against the
// TURN's grant set and returns the instructions addendum that makes the
// equipment discoverable. Session I/O is mocked; the connector catalog is the
// real shipped one (configs/platform/system/integrations).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionListFiles = vi.fn();
const sessionDeleteFiles = vi.fn();
const sessionStageFiles = vi.fn();
vi.mock('./helpers/session_client', () => ({
  sessionListFiles: (...args: unknown[]) => sessionListFiles(...args),
  sessionDeleteFiles: (...args: unknown[]) => sessionDeleteFiles(...args),
  sessionStageFiles: (...args: unknown[]) => sessionStageFiles(...args),
}));

const { buildIntegrationSkillMd, stageIntegrationSkills } =
  await import('./integration_skills');

const SKILLS_DIR = 'workspace/.tale/skills';

describe('buildIntegrationSkillMd — the shipped github connector', () => {
  const md = buildIntegrationSkillMd('github');

  it('documents the call shape and the read operations with their parameters', () => {
    expect(md).not.toBeNull();
    expect(md).toContain('name: integration-github');
    expect(md).toContain('integration({ slug: "github"');
    // A read operation appears with its args hint (required bare, optional ?).
    expect(md).toContain('`get_repo` (args: owner, repo)');
    expect(md).toContain(
      '`list_repos` (args: per_page?, page?, sort?, visibility?)',
    );
    // And its return shape.
    expect(md).toContain('Returns `{ repo:');
  });

  it('names the write operations as not callable from this agent (V1 read-only)', () => {
    expect(md).toContain('`create_issue`');
    expect(md).toContain('NOT callable from this agent yet');
    // Writes never appear as callable operation bullets.
    expect(md).not.toMatch(/^- `create_issue`/m);
  });

  it('carries the blocker guidance and the git-token appendix', () => {
    expect(md).toContain('integration_status');
    expect(md).toContain('no_credential');
    expect(md).toContain('git clone');
    expect(md).toContain('could not read Username');
  });

  it('returns null for a connector that does not ship', () => {
    expect(buildIntegrationSkillMd('does-not-exist')).toBeNull();
  });
});

describe('stageIntegrationSkills', () => {
  beforeEach(() => {
    sessionListFiles.mockReset().mockResolvedValue([]);
    sessionDeleteFiles.mockReset().mockResolvedValue(undefined);
    sessionStageFiles
      .mockReset()
      .mockResolvedValue({ staged: [], skipped: [] });
  });

  it('stages the granted connector and returns the instructions addendum', async () => {
    const addendum = await stageIntegrationSkills({} as never, {
      sessionId: 'sess-1',
      skillsDir: SKILLS_DIR,
      grants: ['github'],
    });

    expect(sessionStageFiles).toHaveBeenCalledTimes(1);
    const files = sessionStageFiles.mock.calls[0]?.[1] as Array<{
      path: string;
      contentBase64: string;
    }>;
    expect(files.map((file) => file.path)).toEqual([
      `${SKILLS_DIR}/integration-github/SKILL.md`,
    ]);
    expect(
      Buffer.from(files[0]?.contentBase64 ?? '', 'base64').toString('utf8'),
    ).toContain('name: integration-github');
    expect(addendum).toContain('Integrations equipped for this conversation');
    expect(addendum).toContain(
      `/user/${SKILLS_DIR}/integration-github/SKILL.md`,
    );
    expect(addendum).toContain('integration_status');
  });

  it('reconciles stale integration skills against the grant set, sparing org skills', async () => {
    sessionListFiles.mockResolvedValue([
      { type: 'dir', name: 'integration-tavily' },
      { type: 'dir', name: 'integration-github' },
      { type: 'dir', name: 'docx' },
      { type: 'file', name: 'integration-notes.md' },
    ]);

    await stageIntegrationSkills({} as never, {
      sessionId: 'sess-1',
      skillsDir: SKILLS_DIR,
      grants: ['github'],
    });

    // Only the connector skill outside the grant set is deleted — a granted
    // one, an org skill, and a plain file are all untouched.
    expect(sessionDeleteFiles).toHaveBeenCalledWith('sess-1', [
      `${SKILLS_DIR}/integration-tavily`,
    ]);
  });

  it('with no grants only reconciles and stages nothing', async () => {
    sessionListFiles.mockResolvedValue([
      { type: 'dir', name: 'integration-github' },
    ]);

    const addendum = await stageIntegrationSkills({} as never, {
      sessionId: 'sess-1',
      skillsDir: SKILLS_DIR,
      grants: [],
    });

    expect(addendum).toBe('');
    expect(sessionDeleteFiles).toHaveBeenCalledWith('sess-1', [
      `${SKILLS_DIR}/integration-github`,
    ]);
    expect(sessionStageFiles).not.toHaveBeenCalled();
  });

  it('skips an unknown granted slug and stages nothing for it', async () => {
    const addendum = await stageIntegrationSkills({} as never, {
      sessionId: 'sess-1',
      skillsDir: SKILLS_DIR,
      grants: ['not-shipped'],
    });

    expect(addendum).toBe('');
    expect(sessionStageFiles).not.toHaveBeenCalled();
  });

  it('downgrades instead of throwing when staging fails', async () => {
    sessionStageFiles.mockRejectedValue(new Error('spawner down'));

    const addendum = await stageIntegrationSkills({} as never, {
      sessionId: 'sess-1',
      skillsDir: SKILLS_DIR,
      grants: ['github'],
    });

    expect(addendum).toBe('');
  });
});
