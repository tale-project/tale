import { describe, expect, it } from 'vitest';

import {
  completeSkillToken,
  conversationSkillsOf,
  insertSkillSlash,
  matchSkills,
  skillTokenAtCaret,
} from './skill-picks';

describe('skillTokenAtCaret', () => {
  it('finds the name typed at the start of the message', () => {
    expect(skillTokenAtCaret('/do', 3)).toEqual({
      start: 0,
      end: 3,
      query: 'do',
    });
    expect(skillTokenAtCaret('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(skillTokenAtCaret('/docx /x', 8)).toEqual({
      start: 6,
      end: 8,
      query: 'x',
    });
  });

  it('takes the whole name when the caret sits inside it', () => {
    expect(skillTokenAtCaret('/docx Write it', 3)).toEqual({
      start: 0,
      end: 5,
      query: 'do',
    });
  });

  it('finds nothing in the message’s own words', () => {
    expect(skillTokenAtCaret('Write it /do', 12)).toBeNull();
    expect(skillTokenAtCaret('/docx ', 6)).toBeNull();
    expect(skillTokenAtCaret('/docx Write', 11)).toBeNull();
    expect(skillTokenAtCaret('/etc/hosts', 10)).toBeNull();
  });
});

describe('completeSkillToken', () => {
  it('writes the name with one space after it, and puts the caret there', () => {
    expect(
      completeSkillToken('/do', { start: 0, end: 3, query: 'do' }, 'docx'),
    ).toEqual({ text: '/docx ', caret: 6 });
    expect(
      completeSkillToken(
        '/x  Write the letter',
        { start: 0, end: 2, query: 'x' },
        'xlsx',
      ),
    ).toEqual({ text: '/xlsx Write the letter', caret: 6 });
  });
});

describe('insertSkillSlash', () => {
  it('opens a name at the start of the message, after the names it has', () => {
    expect(insertSkillSlash('')).toEqual({ text: '/', caret: 1 });
    expect(insertSkillSlash('Write the letter')).toEqual({
      text: '/ Write the letter',
      caret: 1,
    });
    expect(insertSkillSlash('/docx Write the letter')).toEqual({
      text: '/docx / Write the letter',
      caret: 7,
    });
  });
});

describe('matchSkills', () => {
  const skills = [
    { slug: 'brand-docs' },
    { slug: 'docx' },
    { slug: 'pdf' },
    { slug: 'xlsx' },
  ];

  it('puts names that start with the query before names that contain it', () => {
    expect(matchSkills(skills, 'doc').map((skill) => skill.slug)).toEqual([
      'docx',
      'brand-docs',
    ]);
    expect(matchSkills(skills, '')).toHaveLength(4);
    expect(matchSkills(skills, 'zip')).toEqual([]);
  });
});

describe('conversationSkillsOf', () => {
  it('reads the skills a row uses, and nothing that is not a name', () => {
    expect(
      conversationSkillsOf({ skills: ['docx', 'Bad Name', 7], connectors: [] }),
    ).toEqual(['docx']);
    expect(conversationSkillsOf(null)).toEqual([]);
    expect(conversationSkillsOf({ skills: 'docx' })).toEqual([]);
  });
});
