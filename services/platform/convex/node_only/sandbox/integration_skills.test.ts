// Unit tests for the integration SKILL.md builder. The web-access guidance MUST
// match the agent's actual toolset (native vs. governed) so the agent never gets
// told its working tools are disabled, and the github appendix must route a git
// auth failure into the perceive→guide flow.

import { describe, expect, it } from 'vitest';

import { getSkillsStageDir } from '../../../lib/agent-adapters/credential-policy';
import { CLAUDE_COMPAT_SKILLS_STAGE_DIR } from '../../../lib/agent-adapters/types';
import { repoSkillScanDirs } from './integration_skills';

describe('repoSkillScanDirs', () => {
  it('covers every known project-level skill convention at the workspace root', () => {
    expect(repoSkillScanDirs()).toEqual([
      'workspace/.claude/skills',
      'workspace/.codex/skills',
      'workspace/.cursor/skills',
      'workspace/.agents/skills',
      'workspace/.opencode/skills',
      'workspace/.pi/skills',
    ]);
  });

  it('follows the thread sandbox workdir when set (nested paths included)', () => {
    expect(repoSkillScanDirs('tale')).toEqual([
      'workspace/tale/.claude/skills',
      'workspace/tale/.codex/skills',
      'workspace/tale/.cursor/skills',
      'workspace/tale/.agents/skills',
      'workspace/tale/.opencode/skills',
      'workspace/tale/.pi/skills',
    ]);
    expect(repoSkillScanDirs('apps/web')).toContain(
      'workspace/apps/web/.claude/skills',
    );
  });
});

import type { IntegrationCatalogEntry } from '../../integrations/file_actions';
import { buildIntegrationSkillMd } from './integration_skills';

describe('getSkillsStageDir', () => {
  it('returns the Claude-compat dir for supported external runtimes', () => {
    expect(getSkillsStageDir('claude-code')).toBe(
      CLAUDE_COMPAT_SKILLS_STAGE_DIR,
    );
    expect(getSkillsStageDir('cursor')).toBe(CLAUDE_COMPAT_SKILLS_STAGE_DIR);
    expect(getSkillsStageDir('opencode')).toBe(CLAUDE_COMPAT_SKILLS_STAGE_DIR);
  });
});

const tavily: IntegrationCatalogEntry = {
  slug: 'tavily',
  title: 'Tavily Search',
  description: 'Web search and page extraction',
  operations: [
    { name: 'search', description: 'Search the web', operationType: 'read' },
  ],
};

const github: IntegrationCatalogEntry = {
  slug: 'github',
  title: 'GitHub',
  description: 'Repos, issues, and pull requests',
  operations: [{ name: 'list_issues', operationType: 'read' }],
};

describe('buildIntegrationSkillMd — web-access guidance', () => {
  it('says web tools are DISABLED when the agent has no native web tools (governed default)', () => {
    const md = buildIntegrationSkillMd(tavily, { nativeWebTools: false });
    expect(md).toContain('WebSearch and WebFetch tools are DISABLED');
    expect(md).not.toContain('You have native WebSearch and WebFetch');
  });

  it('says native web tools are available (and not "disabled") when the agent has them', () => {
    const md = buildIntegrationSkillMd(tavily, { nativeWebTools: true });
    expect(md).toContain('You have native WebSearch and WebFetch');
    expect(md).not.toContain('DISABLED');
    // Native agents must not be told to connect a search integration for
    // ordinary public-web lookups.
    expect(md).toContain('public-web lookups');
  });

  it('always carries the not_bound / not_configured perceive→guide guidance regardless of web-tool mode', () => {
    for (const nativeWebTools of [true, false]) {
      const md = buildIntegrationSkillMd(tavily, { nativeWebTools });
      expect(md).toContain('not_bound');
      expect(md).toContain('not_configured');
      expect(md).toContain('integration_status');
    }
  });
});

describe('buildIntegrationSkillMd — github appendix', () => {
  it('appends the git-clone/auth-failure guidance only for github', () => {
    const md = buildIntegrationSkillMd(github, { nativeWebTools: true });
    expect(md).toContain('## Cloning or pushing a repo');
    expect(md).toContain('git clone');
    expect(md).toContain('integration_status');
  });

  it('omits the github appendix for other integrations', () => {
    const md = buildIntegrationSkillMd(tavily, { nativeWebTools: true });
    expect(md).not.toContain('## Cloning or pushing a repo');
  });
});
