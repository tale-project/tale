import { buildRulesContent } from './content';

interface RulesFile {
  relativePath: string;
  content: string;
}

function buildCursorMdc(content: string): string {
  const frontmatter = [
    '---',
    'description: Tale project configuration rules',
    'globs: agents/**,workflows/**,integrations/**,branding/**',
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
