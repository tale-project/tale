import { describe, expect, it } from 'vitest';

import { parseSkillMd, SkillFrontmatterError } from './skills';

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
  it('round-trips legacy tool-names / integration-bindings / workflow-bindings under .unknown', () => {
    // These fields are no longer typed — skills are knowledge packs that
    // don't grant capabilities. Existing SKILL.md authors who still write
    // them get passthrough preservation but no semantic effect.
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
    expect(meta.unknown['tool-names']).toEqual(['rag_search']);
    expect(meta.unknown['integration-bindings']).toEqual(['slack']);
    expect(meta.unknown['workflow-bindings']).toEqual(['send-summary']);
  });

  it('preserves role-restriction and shared-with-team-ids under .unknown', () => {
    // These were typed fields in earlier rounds but never had enforcement —
    // a skill author writing `role-restriction: admin_developer` got no
    // actual access control. Removed from the typed schema; now round-trip
    // via `.unknown` so existing SKILL.md files continue to parse but stop
    // implying access semantics they never had.
    const fm = [
      'name: dev-skill',
      'description: developer-only',
      'role-restriction: admin_developer',
      'shared-with-team-ids:',
      '  - eng',
      '  - infra',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.unknown['role-restriction']).toBe('admin_developer');
    expect(meta.unknown['shared-with-team-ids']).toEqual(['eng', 'infra']);
  });

  it('reads recommended-packages frontmatter into normalized shape', () => {
    const fm = [
      'name: pdf-extractor',
      'description: extract PDF text',
      'recommended-packages:',
      '  python:',
      '    - pypdf',
      '  node: []',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.recommendedPackages?.python).toEqual(['pypdf']);
    expect(meta.recommendedPackages?.node).toEqual([]);
  });
});

describe('parseSkillMd — passthrough for community fields', () => {
  it('preserves unknown frontmatter fields under .unknown', () => {
    // `allowed-tools` is intentionally NOT a typed field — it was parsed
    // in earlier rounds but never read at runtime, so it now round-trips
    // via `.unknown` (matching the agentskills.io spec allowance for both
    // array and string forms — Tale just doesn't act on either).
    // `disable-model-invocation` IS typed because the runtime honors it.
    const fm = [
      'name: ok',
      'description: x',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      'when-to-use: "When user asks foo"',
      'disable-model-invocation: false',
    ].join('\n');
    const { meta } = parseSkillMd(wrap(fm));
    expect(meta.unknown['allowed-tools']).toEqual(['Read', 'Bash']);
    expect(meta.unknown['when-to-use']).toBe('When user asks foo');
    expect(meta.disableModelInvocation).toBe(false);
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

  it('truncates frontmatter at the first inner `---` line (no document merging)', () => {
    // Two `---` blocks inside the frontmatter region should close the
    // frontmatter at the first inner `---` line. Anything after becomes
    // body — it must NOT silently merge into the parsed metadata.
    const { meta, body } = parseSkillMd(
      wrap('name: ok\ndescription: first\n---\nname: ok2\ndescription: second'),
    );
    expect(meta.name).toBe('ok');
    expect(meta.description).toBe('first');
    // The second `name`/`description` falls through to the body — proves
    // we are not concatenating documents into the metadata.
    expect(body).toContain('name: ok2');
    expect(body).toContain('description: second');
  });

  it('rejects non-mapping frontmatter (top-level array)', () => {
    expect(() => parseSkillMd(wrap('- a\n- b'))).toThrow(SkillFrontmatterError);
  });

  it('rejects empty frontmatter', () => {
    expect(() => parseSkillMd(wrap(''))).toThrow(SkillFrontmatterError);
  });
});

// SKILL_RESERVED_TOOL_NAMES retired with the skill_run tool — skills no
// longer declare `tool-names` so there's nothing to reserve against.
