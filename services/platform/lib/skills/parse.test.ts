import { describe, expect, it } from 'vitest';

import { parseSkillMd, SkillParseError, serializeSkillMd } from './parse';

const PATH = '/config/acme/skills/write-notes/SKILL.md';

function skillMd(
  frontmatter: string,
  body = '# Write notes\n\nBody.\n',
): string {
  return `---\n${frontmatter}---\n\n${body}`;
}

describe('parseSkillMd', () => {
  it('parses frontmatter and body, normalizing the kebab-case wire keys', () => {
    const { meta, body } = parseSkillMd(
      skillMd(
        [
          'name: write-notes',
          "description: 'Write the note before the work.'",
          'visibility: private',
          'owner: user_42',
          'icon: lucide:notebook-pen',
          "labels: ['Authoring']",
          'disable-model-invocation: true',
          'recommended-packages:',
          '  python:',
          '    - ruff',
          '',
        ].join('\n'),
      ),
      PATH,
    );

    expect(meta.name).toBe('write-notes');
    expect(meta.description).toBe('Write the note before the work.');
    expect(meta.visibility).toBe('private');
    expect(meta.owner).toBe('user_42');
    expect(meta.icon).toBe('lucide:notebook-pen');
    expect(meta.labels).toEqual(['Authoring']);
    expect(meta.disableModelInvocation).toBe(true);
    expect(meta.recommendedPackages).toEqual({ python: ['ruff'] });
    expect(body).toBe('# Write notes\n\nBody.\n');
  });

  it('treats a bundle with no visibility as belonging to the whole org', () => {
    const { meta } = parseSkillMd(
      skillMd('name: pdf\ndescription: Fill in PDF forms.\n'),
      PATH,
    );

    expect(meta.visibility).toBe('org');
    expect(meta.owner).toBeUndefined();
  });

  it('keeps community frontmatter keys the schema does not name', () => {
    const { meta } = parseSkillMd(
      skillMd(
        [
          'name: pdf',
          'description: Fill in PDF forms.',
          "allowed-tools: ['Read']",
          'when-to-use: always',
          '',
        ].join('\n'),
      ),
      PATH,
    );

    expect(meta.extra).toEqual({
      'allowed-tools': ['Read'],
      'when-to-use': 'always',
    });
  });

  it('rejects a private skill with no owner, naming the file', () => {
    expect(() =>
      parseSkillMd(
        skillMd(
          'name: pdf\ndescription: Fill in forms.\nvisibility: private\n',
        ),
        PATH,
      ),
    ).toThrow(SkillParseError);

    try {
      parseSkillMd(
        skillMd(
          'name: pdf\ndescription: Fill in forms.\nvisibility: private\n',
        ),
        PATH,
      );
      expect.unreachable('a private skill without an owner must not parse');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillParseError);
      expect((err as SkillParseError).path).toBe(PATH);
      expect((err as SkillParseError).message).toContain(PATH);
      expect((err as SkillParseError).message).toContain('owner');
    }
  });

  it('fails loudly with the path when the YAML is malformed', () => {
    try {
      parseSkillMd(skillMd('name: pdf\n  description: [broken\n'), PATH);
      expect.unreachable('broken YAML must not parse');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillParseError);
      expect((err as SkillParseError).path).toBe(PATH);
      expect((err as SkillParseError).message).toContain(PATH);
    }
  });

  it('fails loudly with the path when a required field is missing', () => {
    try {
      parseSkillMd(skillMd('name: pdf\n'), PATH);
      expect.unreachable('a description-less skill must not parse');
    } catch (err) {
      expect((err as SkillParseError).message).toContain(PATH);
      expect((err as SkillParseError).detail).toContain('description');
    }
  });

  it('rejects a document that does not open with a frontmatter fence', () => {
    try {
      parseSkillMd('# Just markdown\n', PATH);
      expect.unreachable('a fence-less document must not parse');
    } catch (err) {
      expect((err as SkillParseError).message).toContain(PATH);
      expect((err as SkillParseError).line).toBe(1);
    }
  });

  it('rejects frontmatter that is never closed', () => {
    try {
      parseSkillMd('---\nname: pdf\ndescription: x\n', PATH);
      expect.unreachable('an unclosed fence must not parse');
    } catch (err) {
      expect((err as SkillParseError).detail).toContain('never closed');
    }
  });

  it('rejects a slug shape no directory may carry', () => {
    for (const name of ['Write-Notes', 'write--notes', '-notes', 'claude']) {
      expect(() =>
        parseSkillMd(skillMd(`name: ${name}\ndescription: x\n`), PATH),
      ).toThrow(SkillParseError);
    }
  });
});

describe('serializeSkillMd', () => {
  it('round-trips a skill without touching its prose', () => {
    const source = skillMd(
      [
        'name: write-notes',
        'description: Write the note before the work.',
        'visibility: org',
        'owner: user_42',
        'license: MIT',
        "allowed-tools: ['Read']",
        '',
      ].join('\n'),
      '# Write notes\n\nOne\n\nTwo\n',
    );

    const first = parseSkillMd(source, PATH);
    const rewritten = serializeSkillMd(first.meta, first.body);
    const second = parseSkillMd(rewritten, PATH);

    expect(second.meta).toEqual(first.meta);
    expect(second.body).toBe('# Write notes\n\nOne\n\nTwo\n');
    // A second save of an untouched skill must not churn the file.
    expect(serializeSkillMd(second.meta, second.body)).toBe(rewritten);
  });

  it('always writes the visibility a reader would otherwise have to assume', () => {
    const { meta, body } = parseSkillMd(
      skillMd('name: pdf\ndescription: Fill in forms.\n'),
      PATH,
    );

    expect(serializeSkillMd(meta, body)).toContain('visibility: org');
  });
});
