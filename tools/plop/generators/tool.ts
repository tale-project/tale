import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/tool');

type ToolKind = 'typescript' | 'shell';

interface Answers {
  name: string;
  description: string;
  kind: ToolKind;
}

const FILES_BY_KIND: Record<ToolKind, string[]> = {
  typescript: [
    'package.json.hbs',
    'tsconfig.json.hbs',
    '.oxlintrc.json.hbs',
    '.gitignore',
    'README.md.hbs',
    'src/index.ts',
    'tests/smoke.test.ts.hbs',
  ],
  shell: ['package.json.hbs', 'run.sh.hbs', '.gitignore', 'README.md.hbs'],
};

export function registerTool(plop: NodePlopAPI): void {
  plop.setGenerator('tool', {
    description:
      'Runnable tooling workspace under tools/ (typescript = bun CLI like tools/cli; shell = run.sh + config like tools/opengrep)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Tool name (kebab-case):',
        validate: (v: string) =>
          /^[a-z]([a-z0-9-]*[a-z0-9])?$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale tooling workspace',
      },
      {
        type: 'list',
        name: 'kind',
        message: 'Tool kind:',
        choices: [
          { name: 'TypeScript CLI (bun, like tools/cli)', value: 'typescript' },
          {
            name: 'Shell + config (run.sh, like tools/opengrep)',
            value: 'shell',
          },
        ],
        default: 'typescript',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `tools/{{kebabCase name}}`;
      const kindDir = answers.kind;
      const files = FILES_BY_KIND[kindDir];

      return files.map<ActionType>((file) => {
        const isHbs = file.endsWith('.hbs');
        return {
          type: 'add',
          path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
          templateFile: `${templateDir}/${kindDir}/${file}`,
          data: answers,
        };
      });
    },
  });
}
