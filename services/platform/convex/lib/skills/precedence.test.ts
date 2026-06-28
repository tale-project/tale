import { describe, expect, it } from 'vitest';

import { selectStageableSkills } from './precedence';

interface Skill {
  readonly name: string;
}
const nameOf = (s: Skill): string => s.name;

describe('selectStageableSkills', () => {
  it('keeps every Tale skill when the repo provides none', () => {
    const tale: Skill[] = [{ name: 'pptx' }, { name: 'integration-github' }];
    const result = selectStageableSkills(tale, nameOf, new Set());
    expect(result.kept).toEqual(tale);
    expect(result.dropped).toEqual([]);
  });

  it('drops a Tale skill the repo also defines — the repo wins', () => {
    const tale: Skill[] = [{ name: 'pptx' }, { name: 'integration-github' }];
    const result = selectStageableSkills(tale, nameOf, new Set(['pptx']));
    expect(result.kept).toEqual([{ name: 'integration-github' }]);
    expect(result.dropped).toEqual(['pptx']);
  });

  it('drops all when the repo shadows every Tale skill', () => {
    const tale: Skill[] = [{ name: 'a' }, { name: 'b' }];
    const result = selectStageableSkills(tale, nameOf, new Set(['a', 'b']));
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual(['a', 'b']);
  });

  it('matches names exactly (case-sensitive, no partial match)', () => {
    const tale: Skill[] = [{ name: 'PPTX' }, { name: 'pptx-helper' }];
    const result = selectStageableSkills(tale, nameOf, new Set(['pptx']));
    expect(result.kept).toEqual(tale);
    expect(result.dropped).toEqual([]);
  });
});
