import { describe, expect, it } from 'vitest';

import {
  CHOSEN_SKILLS_MAX,
  chosenSkills,
  isSkillName,
  leadingSkillNames,
  withoutLeadingSkillNames,
} from './slash';

describe('leadingSkillNames', () => {
  it('reads the names a message starts with, in order and once each', () => {
    expect(leadingSkillNames('/docx Write the cover letter')).toEqual(['docx']);
    expect(leadingSkillNames('  /xlsx /brand-voice\nMonthly revenue')).toEqual([
      'xlsx',
      'brand-voice',
    ]);
    expect(leadingSkillNames('/pdf /pdf merge these')).toEqual(['pdf']);
    expect(leadingSkillNames('/docx')).toEqual(['docx']);
  });

  it('reads nothing that is not a name at the start', () => {
    expect(leadingSkillNames('Write it with /docx')).toEqual([]);
    expect(leadingSkillNames('/etc/hosts is read-only')).toEqual([]);
    expect(leadingSkillNames('/Docx please')).toEqual([]);
    expect(leadingSkillNames('/ docx')).toEqual([]);
    expect(leadingSkillNames('')).toEqual([]);
  });

  it('stops at the first word that is not a name', () => {
    expect(leadingSkillNames('/docx please /pdf')).toEqual(['docx']);
  });
});

describe('withoutLeadingSkillNames', () => {
  it('keeps what the message says after the names it starts with', () => {
    expect(withoutLeadingSkillNames('/docx Write the cover letter')).toBe(
      'Write the cover letter',
    );
    expect(withoutLeadingSkillNames(' /xlsx /pdf\nMonthly revenue ')).toBe(
      'Monthly revenue',
    );
    expect(withoutLeadingSkillNames('Write it with /docx')).toBe(
      'Write it with /docx',
    );
  });

  it('keeps a message that is nothing but names, or no name at all', () => {
    expect(withoutLeadingSkillNames('/docx /pdf')).toBe('/docx /pdf');
    expect(withoutLeadingSkillNames('/etc/hosts is read-only')).toBe(
      '/etc/hosts is read-only',
    );
    expect(withoutLeadingSkillNames(`/${'a'.repeat(65)} text`)).toBe(
      `/${'a'.repeat(65)} text`,
    );
  });
});

describe('isSkillName', () => {
  it('takes a folder name and refuses anything else', () => {
    expect(isSkillName('brand-voice')).toBe(true);
    expect(isSkillName('Brand')).toBe(false);
    expect(isSkillName('a--b')).toBe(false);
    expect(isSkillName('a'.repeat(65))).toBe(false);
  });
});

describe('chosenSkills [CHAT-R29]', () => {
  const library = new Set(['docx', 'xlsx', 'pdf', 'pptx', 'brand-voice']);

  it('takes the message’s names first, then the conversation’s', () => {
    expect(chosenSkills('/pdf Merge them', ['docx', 'pdf'], library)).toEqual([
      'pdf',
      'docx',
    ]);
  });

  it('keeps only what the person can use, as text otherwise', () => {
    expect(chosenSkills('/finance-review Check this', [], library)).toEqual([]);
    expect(chosenSkills('Hello', ['gone'], library)).toEqual([]);
  });

  it(`reads at most ${CHOSEN_SKILLS_MAX}`, () => {
    expect(
      chosenSkills('/docx /xlsx /pdf', ['pptx', 'brand-voice'], library),
    ).toEqual(['docx', 'xlsx', 'pdf', 'pptx']);
  });
});
