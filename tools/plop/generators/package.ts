import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/package');

type PackageKind = 'react' | 'typescript';

interface Answers {
  name: string;
  description: string;
  kind: PackageKind;
  storybook: boolean;
}

// Files scaffolded per kind, relative to templates/package/<kind>/. `react` is a
// component library (TSX + Tailwind preset + i18n bundle, like @tale/ui);
// `typescript` is a plain source-consumed library (like @tale/shared).
const FILES_BY_KIND: Record<PackageKind, string[]> = {
  react: [
    'package.json.hbs',
    'tsconfig.json.hbs',
    'vitest.config.ts.hbs',
    'postcss.config.mjs',
    '.gitignore',
    '.oxlintrc.json.hbs',
    'README.md.hbs',
    'src/index.ts',
    'src/globals.css',
    'src/i18n/messages.ts.hbs',
    'src/messages/en.yml',
    'src/messages/de.yml',
    'src/messages/fr.yml',
    'src/messages/global.yml',
    'src/messages/messages.test.ts',
    'tailwind-preset.ts',
    'tests/setup.ts',
  ],
  typescript: [
    'package.json.hbs',
    'tsconfig.json.hbs',
    '.gitignore',
    '.oxlintrc.json.hbs',
    'README.md.hbs',
    'src/index.ts',
    'tests/smoke.test.ts.hbs',
  ],
};

// Storybook is React-only and opt-in.
const STORYBOOK_FILES = [
  '.storybook/main.ts.hbs',
  '.storybook/preview.tsx.hbs',
  '.storybook/manager.ts',
];

export function registerPackage(plop: NodePlopAPI): void {
  plop.setGenerator('package', {
    description:
      'Workspace package under packages/ (react = component library like @tale/ui; typescript = plain TS library like @tale/shared)',
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
      {
        type: 'list',
        name: 'kind',
        message: 'Package kind:',
        choices: [
          {
            name: 'React component library (TSX + Tailwind preset)',
            value: 'react',
          },
          {
            name: 'TypeScript library (source consumed directly)',
            value: 'typescript',
          },
        ],
        default: 'react',
      },
      {
        // Unconditional (no `when`) so the generator stays fully bypassable for
        // non-interactive / agent use: `gen package <name> <desc> <kind>
        // <storybook>`. Ignored unless kind === 'react'.
        type: 'confirm',
        name: 'storybook',
        message: 'Include Storybook? (react only)',
        default: true,
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `packages/{{kebabCase name}}`;
      const files = [...FILES_BY_KIND[answers.kind]];
      if (answers.kind === 'react' && answers.storybook) {
        files.push(...STORYBOOK_FILES);
      }

      return files.map<ActionType>((file) => {
        const isHbs = file.endsWith('.hbs');
        return {
          type: 'add',
          path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
          templateFile: `${templateDir}/${answers.kind}/${file}`,
          data: answers,
        };
      });
    },
  });
}
