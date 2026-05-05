import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/typescript-package');

interface Answers {
  name: string;
  description: string;
}

export function registerTypescriptPackage(plop: NodePlopAPI): void {
  plop.setGenerator('typescript-package', {
    description:
      'TypeScript library workspace (no build, type-checked source consumed directly)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Package name (kebab-case, e.g. "ui"):',
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale library package',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `packages/{{kebabCase name}}`;
      const files = [
        'package.json.hbs',
        'tsconfig.json.hbs',
        '.gitignore',
        '.oxlintrc.json',
        'README.md.hbs',
        'src/index.ts',
      ];

      return files.map<ActionType>((file) => {
        const isHbs = file.endsWith('.hbs');
        return {
          type: 'add',
          path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
          templateFile: `${templateDir}/${file}`,
          data: answers,
        };
      });
    },
  });
}
