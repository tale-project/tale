import { buildRulesContent } from './content';

interface RulesFile {
  relativePath: string;
  content: string;
}

function buildCursorMdc(content: string): string {
  // Globs match the org-first layout: any direct subdir of the project
  // root that contains the canonical domain dirs. Covers `default/` and
  // any additional org subtree (`acme/`, etc.) without listing each.
  const frontmatter = [
    '---',
    'description: Tale project configuration rules',
    'globs: */agents/**,*/workflows/**,*/integrations/**,*/branding/**,*/providers/**,*/skills/**,*/retention.json',
    '---',
    '',
  ].join('\n');

  return frontmatter + content;
}

export function generateAllRules(): RulesFile[] {
  const content = buildRulesContent();

  return [
    { relativePath: 'CLAUDE.md', content },
    {
      relativePath: '.cursor/rules/tale.mdc',
      content: buildCursorMdc(content),
    },
    { relativePath: '.github/copilot-instructions.md', content },
    { relativePath: '.windsurfrules', content },
  ];
}
