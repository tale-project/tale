import { describe, expect, it } from 'vitest';

import {
  describeSkillSlugProblem,
  isValidSkillSlug,
  MAX_SKILL_BODY_BYTES,
  MAX_SKILL_FRONTMATTER_BYTES,
  MAX_SKILL_MD_BYTES,
  MAX_SKILL_SLUG_LENGTH,
  skillBodyByteLength,
  skillEditFields,
} from './skills.ts';

/**
 * The one slug describer every door shares. The regression under test: a
 * 100-character slug of lowercase letters was refused with the CHARSET
 * sentence — the length rule and the reserved names were stated nowhere,
 * and the whole slug was echoed back however long it was.
 */
describe('describeSkillSlugProblem', () => {
  it('is null for a usable slug', () => {
    expect(describeSkillSlugProblem('web-research')).toBeNull();
    expect(
      describeSkillSlugProblem('a'.repeat(MAX_SKILL_SLUG_LENGTH)),
    ).toBeNull();
    expect(isValidSkillSlug('web-research')).toBe(true);
  });

  it('names the length rule for an over-long slug and truncates the echo', () => {
    const slug = 'a'.repeat(100);
    const problem = describeSkillSlugProblem(slug);
    expect(problem).toContain('100 characters long');
    expect(problem).toContain(`at most ${MAX_SKILL_SLUG_LENGTH}`);
    expect(problem).not.toContain(slug);
    expect(problem).toContain(`${'a'.repeat(MAX_SKILL_SLUG_LENGTH)}…`);
    expect(problem).not.toContain('lowercase');
    expect(isValidSkillSlug(slug)).toBe(false);
  });

  it('names the charset rule for a malformed slug', () => {
    for (const slug of [
      'Web-Research',
      'web research',
      '-web',
      'web--research',
      'a/b',
    ]) {
      expect(describeSkillSlugProblem(slug), slug).toContain(
        'lowercase letters, digits and single hyphens',
      );
    }
  });

  it('names the reserved slugs', () => {
    expect(describeSkillSlugProblem('claude')).toContain('reserved');
    expect(describeSkillSlugProblem('anthropic')).toContain('"claude"');
  });

  it('names an empty slug', () => {
    expect(describeSkillSlugProblem('')).toContain('empty');
  });
});

/**
 * The body budget is published as ONE number a client can compute against:
 * bytes of UTF-8, never characters, and always small enough that the
 * composed SKILL.md fits its own cap with the frontmatter at ITS cap.
 */
describe('skillEditFields.body', () => {
  it('counts UTF-8 bytes, not characters', () => {
    const half = Math.floor(MAX_SKILL_BODY_BYTES / 2);
    const twoByte = 'é'.repeat(half);
    expect(skillBodyByteLength(twoByte)).toBe(2 * half);
    expect(skillEditFields.body.safeParse(twoByte).success).toBe(true);
    // One more character is two more bytes — over the cap while the
    // character count is still far below it.
    const over = 'é'.repeat(half + 1);
    expect(over.length).toBeLessThan(MAX_SKILL_BODY_BYTES);
    const refused = skillEditFields.body.safeParse(over);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => issue.message)).toEqual([
      `must be at most ${MAX_SKILL_BODY_BYTES} bytes of UTF-8`,
    ]);
  });

  it('leaves room for a frontmatter at its own cap inside the document cap', () => {
    expect(MAX_SKILL_BODY_BYTES + MAX_SKILL_FRONTMATTER_BYTES).toBeLessThan(
      MAX_SKILL_MD_BYTES,
    );
  });
});
