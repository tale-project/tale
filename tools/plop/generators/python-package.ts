import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/python-package');

interface Answers {
  name: string;
  description: string;
}

export function registerPythonPackage(plop: NodePlopAPI): void {
  plop.setGenerator('python-package', {
    description:
      'Python library workspace (mirrors packages/tale_shared, tale_knowledge, tale_telemetry)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message:
          'Package name (kebab-case; will be snake_cased for the directory and module):',
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale Python package',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `packages/tale_{{snakeCase name}}`;
      const files: { from: string; to: string }[] = [
        { from: 'package.json.hbs', to: 'package.json' },
        { from: 'pyproject.toml.hbs', to: 'pyproject.toml' },
        { from: '.gitignore', to: '.gitignore' },
        { from: 'README.md.hbs', to: 'README.md' },
        {
          from: 'src/snake_case_package/__init__.py',
          to: 'src/tale_{{snakeCase name}}/__init__.py',
        },
        { from: 'tests/__init__.py', to: 'tests/__init__.py' },
      ];

      return files.map<ActionType>((file) => ({
        type: 'add',
        path: `${dest}/${file.to}`,
        templateFile: `${templateDir}/${file.from}`,
        data: answers,
      }));
    },
  });
}
