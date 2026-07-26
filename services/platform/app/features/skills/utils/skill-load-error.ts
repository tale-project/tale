export type SkillLoadErrorKind =
  | 'yaml_syntax'
  | 'missing_frontmatter'
  | 'unclosed_frontmatter'
  | 'frontmatter_too_large'
  | 'invalid_frontmatter'
  | 'empty_frontmatter'
  | 'not_found'
  | 'symlink'
  | 'inaccessible'
  | 'generic';

export interface SkillLoadErrorPresentation {
  kind: SkillLoadErrorKind;
  line?: number;
  column?: number;
}

const YAML_LOCATION_RE = /at line (\d+)(?:, column (\d+))?/;

/**
 * Classify a skill list/read error into a short summary bucket for banner
 * rows and detail headlines. The raw `message` stays available for technical
 * detail.
 */
export function resolveSkillLoadErrorPresentation(
  status?: string,
  message?: string,
): SkillLoadErrorPresentation {
  if (status === 'not_found') return { kind: 'not_found' };
  if (status === 'symlink') return { kind: 'symlink' };
  if (status === 'inaccessible') return { kind: 'inaccessible' };

  const msg = message ?? '';

  if (msg.startsWith('YAML parse error:')) {
    const match = YAML_LOCATION_RE.exec(msg);
    return {
      kind: 'yaml_syntax',
      line: match ? Number(match[1]) : undefined,
      column: match?.[2] ? Number(match[2]) : undefined,
    };
  }
  if (msg.includes('must begin with YAML frontmatter')) {
    return { kind: 'missing_frontmatter' };
  }
  if (msg.includes('YAML frontmatter is not closed')) {
    return { kind: 'unclosed_frontmatter' };
  }
  if (msg.includes('Frontmatter exceeds')) {
    return { kind: 'frontmatter_too_large' };
  }
  if (msg.startsWith('Invalid frontmatter')) {
    return { kind: 'invalid_frontmatter' };
  }
  if (msg.includes('Frontmatter is empty')) {
    return { kind: 'empty_frontmatter' };
  }
  if (msg.includes('Frontmatter must be a YAML mapping')) {
    return { kind: 'invalid_frontmatter' };
  }

  return { kind: 'generic' };
}

/** The headline key for one classified failure, in the `skills` namespace. */
export function skillLoadErrorDetailTitleKey(
  presentation: SkillLoadErrorPresentation,
): string {
  return DETAIL_TITLE_KEYS[presentation.kind];
}

const DETAIL_TITLE_KEYS: Record<SkillLoadErrorKind, string> = {
  yaml_syntax: 'loadErrorDetail.title.yamlSyntax',
  missing_frontmatter: 'loadErrorDetail.title.missingFrontmatter',
  unclosed_frontmatter: 'loadErrorDetail.title.unclosedFrontmatter',
  frontmatter_too_large: 'loadErrorDetail.title.frontmatterTooLarge',
  invalid_frontmatter: 'loadErrorDetail.title.invalidFrontmatter',
  empty_frontmatter: 'loadErrorDetail.title.emptyFrontmatter',
  not_found: 'notFound',
  symlink: 'loadErrorDetail.title.symlink',
  inaccessible: 'loadErrorDetail.title.inaccessible',
  generic: 'loadErrorDetail.title.generic',
};
