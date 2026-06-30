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

  // The image-baked visual-aspect-analyzer is symlinked into the session skill
  // dir by the sandbox-runtime entrypoint; reconcileBuiltinSkills
  // (node_only/sandbox/integration_skills.ts) runs this same filter per turn and
  // removes the baked symlink for any name the repo also defines (`dropped`), so
  // the repo's project-level skill wins. (browser-human-control uses the same
  // filter inline via stageBrowserControlSkill.)
  it('keeps the visual-aspect-analyzer builtin when the repo has no skill of that name', () => {
    const tale: Skill[] = [{ name: 'visual-aspect-analyzer' }];
    const result = selectStageableSkills(
      tale,
      nameOf,
      new Set(['some-other-skill']),
    );
    expect(result.kept).toEqual(tale);
    expect(result.dropped).toEqual([]);
  });

  it('defers the visual-aspect-analyzer builtin to a same-named repo skill', () => {
    const tale: Skill[] = [{ name: 'visual-aspect-analyzer' }];
    const result = selectStageableSkills(
      tale,
      nameOf,
      new Set(['visual-aspect-analyzer']),
    );
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual(['visual-aspect-analyzer']);
  });
});
