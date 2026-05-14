import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/react-package');

interface Answers {
  name: string;
  description: string;
  storybook: boolean;
}

export function registerReactPackage(plop: NodePlopAPI): void {
  plop.setGenerator('react-package', {
    description:
      'React component library (TSX + Tailwind preset + globals.css; for shared UI like @tale/ui)',
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
        default: 'Tale shared React components',
      },
      {
        type: 'confirm',
        name: 'storybook',
        message: 'Include Storybook?',
        default: true,
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `packages/{{kebabCase name}}`;
      const baseFiles = [
        'package.json.hbs',
        'tsconfig.json.hbs',
        'vitest.config.ts.hbs',
        '.gitignore',
        '.oxlintrc.json',
        'README.md.hbs',
        'src/index.ts',
        'src/globals.css',
        'src/test/setup.ts',
        'src/i18n/messages.ts.hbs',
        'src/messages/en.json',
        'src/messages/de.json',
        'src/messages/fr.json',
        'src/messages/global.json',
        'src/messages/messages.test.ts',
        'tailwind-preset.ts',
      ];
      const storybookFiles = [
        '.storybook/main.ts.hbs',
        '.storybook/preview.tsx.hbs',
        '.storybook/manager.ts',
      ];
      const files = answers.storybook
        ? [...baseFiles, ...storybookFiles]
        : baseFiles;

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
