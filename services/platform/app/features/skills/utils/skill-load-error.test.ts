import { describe, expect, it } from 'vitest';

import {
  resolveSkillLoadErrorPresentation,
  skillLoadErrorDetailTitleKey,
} from './skill-load-error';

describe('resolveSkillLoadErrorPresentation', () => {
  it('maps list status codes', () => {
    expect(
      resolveSkillLoadErrorPresentation('not_found', 'SKILL.md not found'),
    ).toEqual({
      kind: 'not_found',
    });
    expect(resolveSkillLoadErrorPresentation('symlink', 'rejected')).toEqual({
      kind: 'symlink',
    });
  });

  it('extracts YAML line numbers from parser messages', () => {
    expect(
      resolveSkillLoadErrorPresentation(
        'corrupted',
        'YAML parse error: Nested mappings are not allowed in compact mappings at line 2, column 14: description: broken',
      ),
    ).toEqual({ kind: 'yaml_syntax', line: 2, column: 14 });
  });

  it('classifies frontmatter shape errors', () => {
    expect(
      resolveSkillLoadErrorPresentation(
        'corrupted',
        'SKILL.md must begin with YAML frontmatter delimited by `---` lines',
      ),
    ).toEqual({ kind: 'missing_frontmatter' });
    expect(
      resolveSkillLoadErrorPresentation(
        'corrupted',
        'YAML frontmatter is not closed by a `---` line',
      ),
    ).toEqual({ kind: 'unclosed_frontmatter' });
  });
});

describe('skillLoadErrorDetailTitleKey', () => {
  it('maps detail titles per kind', () => {
    expect(skillLoadErrorDetailTitleKey({ kind: 'yaml_syntax', line: 2 })).toBe(
      'loadErrorDetail.title.yamlSyntax',
    );
    expect(skillLoadErrorDetailTitleKey({ kind: 'not_found' })).toBe(
      'notFound',
    );
  });
});
