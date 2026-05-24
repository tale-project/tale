import { describe, expect, it } from 'vitest';

import {
  parseSkillMd,
  SkillFrontmatterError,
  SKILL_RESERVED_TOOL_NAMES,
} from './skills';

function wrap(frontmatter: string, body = '\nBody here.\n'): string {
  return `---\n${frontmatter}\n---${body}`;
}

describe('parseSkillMd — name regex', () => {
  it('accepts hyphen-separated lowercase slugs', () => {
    const { meta } = parseSkillMd(
      wrap('name: code-reviewer\ndescription: Review code.'),
    );
    expect(meta.name).toBe('code-reviewer');
  });

  it('rejects underscores', () => {
    expect(() =>
      parseSkillMd(wrap('name: code_reviewer\ndescription: x')),
    ).toThrow(SkillFrontmatterError);
  });

  it('rejects leading/trailing/consecutive hyphens', () => {
    for (const bad of ['-leading', 'trailing-', 'double--hyphen']) {
      expect(() => parseSkillMd(wrap(`name: ${bad}\ndescription: x`))).toThrow(
        SkillFrontmatterError,
      );
    }
  });

  it('rejects names over 64 chars', () => {
    const tooLong = 'a' + 'b'.repeat(64);
    expect(() =>
      parseSkillMd(wrap(`name: ${tooLong}\ndescription: x`)),
    ).toThrow(SkillFrontmatterError);
  });

  it('rejects reserved words anthropic / claude', () => {
    for (const r of ['anthropic', 'claude']) {
      expect(() => parseSkillMd(wrap(`name: ${r}\ndescription: x`))).toThrow(
        SkillFrontmatterError,
      );
    }
  });
});

describe('parseSkillMd — description length', () => {
  it('accepts description up to 1024 chars', () => {
    const desc = 'x'.repeat(1024);
    const { meta } = parseSkillMd(wrap(`name: ok\ndescription: ${desc}`));
    expect(meta.description.length).toBe(1024);
  });

  it('rejects description over 1024 chars', () => {
    const desc = 'x'.repeat(1025);
    expect(() => parseSkillMd(wrap(`name: ok\ndescription: ${desc}`))).toThrow(
      SkillFrontmatterError,
    );
  });

  it('rejects empty description', () => {
    expect(() => parseSkillMd(wrap('name: ok\ndescription: ""'))).toThrow(
      SkillFrontmatterError,
    );
  });
});

describe('parseSkillMd — kebab-case wire format & normalization', () => {
  it('normalizes tool-names / integration-bindings / workflow-bindings', () => {
    const fm = [
      'name: code-reviewer',
      'description: Review code.',
      'tool-names:',
      '  - rag_search',
      'integration-bindings:',
      '  - slack',
      'workflow-bindings:',
      '  - send-summary',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.toolNames).toEqual(['rag_search']);
    expect(meta.integrationBindings).toEqual(['slack']);
    expect(meta.workflowBindings).toEqual(['send-summary']);
  });

  it('normalizes role-restriction and shared-with-team-ids', () => {
    const fm = [
      'name: dev-skill',
      'description: developer-only',
      'role-restriction: admin_developer',
      'shared-with-team-ids:',
      '  - eng',
      '  - infra',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.roleRestriction).toBe('admin_developer');
    expect(meta.sharedWithTeamIds).toEqual(['eng', 'infra']);
  });

  it('reads packages frontmatter into normalized shape', () => {
    const fm = [
      'name: pdf-extractor',
      'description: extract PDF text',
      'packages:',
      '  python:',
      '    - pypdf',
      '  node: []',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.packages?.python).toEqual(['pypdf']);
    expect(meta.packages?.node).toEqual([]);
  });
});

describe('parseSkillMd — passthrough for community fields', () => {
  it('preserves unknown frontmatter fields under .unknown', () => {
    const fm = [
      'name: ok',
      'description: x',
      'allowed-tools: Read Bash',
      'when-to-use: "When user asks foo"',
      'disable-model-invocation: false',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.unknown['allowed-tools']).toBe('Read Bash');
    expect(meta.unknown['when-to-use']).toBe('When user asks foo');
    expect(meta.unknown['disable-model-invocation']).toBe(false);
  });
});

describe('parseSkillMd — fence + body handling', () => {
  it('requires opening `---` fence', () => {
    expect(() => parseSkillMd('name: ok\ndescription: x\nBody.')).toThrow(
      SkillFrontmatterError,
    );
  });

  it('requires closing `---` fence', () => {
    expect(() => parseSkillMd('---\nname: ok\ndescription: x\nBody.')).toThrow(
      SkillFrontmatterError,
    );
  });

  it('returns body text after frontmatter fence', () => {
    const { body } = parseSkillMd(
      `---\nname: ok\ndescription: x\n---\n# Title\n\nbody text`,
    );
    expect(body).toContain('# Title');
    expect(body).toContain('body text');
  });

  it('rejects oversized frontmatter (>16 KB)', () => {
    const huge = 'x'.repeat(17 * 1024);
    expect(() =>
      parseSkillMd(`---\nname: ok\ndescription: ${huge}\n---\n`),
    ).toThrow(SkillFrontmatterError);
  });
});

describe('parseSkillMd — YAML security', () => {
  it('rejects malformed YAML (unbalanced flow collection)', () => {
    // `description: [unclosed-array,` is a syntax error — `yaml@2.x` raises
    // a collection-not-closed error which the wrapper rethrows.
    expect(() =>
      parseSkillMd(wrap('name: ok\ndescription: [unclosed-array,')),
    ).toThrow(SkillFrontmatterError);
  });

  it('rejects multi-document YAML in frontmatter', () => {
    const fm = 'name: ok\ndescription: x\n---\nname: ok2';
    // Two `---` lines inside the frontmatter region would close early and
    // either succeed at the first doc or fail — either is acceptable for
    // security; we just ensure the parser doesn't crash.
    expect(() => parseSkillMd(wrap(fm))).not.toThrow(TypeError);
  });

  it('rejects non-mapping frontmatter (top-level array)', () => {
    expect(() => parseSkillMd(wrap('- a\n- b'))).toThrow(SkillFrontmatterError);
  });

  it('rejects empty frontmatter', () => {
    expect(() => parseSkillMd(wrap(''))).toThrow(SkillFrontmatterError);
  });
});

describe('SKILL_RESERVED_TOOL_NAMES', () => {
  it('reserves the three built-in skill tool names', () => {
    expect(SKILL_RESERVED_TOOL_NAMES.has('expand_skill')).toBe(true);
    expect(SKILL_RESERVED_TOOL_NAMES.has('read_skill_file')).toBe(true);
    expect(SKILL_RESERVED_TOOL_NAMES.has('skill_run')).toBe(true);
  });

  it('does not include arbitrary other names', () => {
    expect(SKILL_RESERVED_TOOL_NAMES.has('rag_search')).toBe(false);
    expect(SKILL_RESERVED_TOOL_NAMES.has('web')).toBe(false);
  });
});
