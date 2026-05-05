import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/python-service');

interface Answers {
  name: string;
  description: string;
  port: string;
}

export function registerPythonService(plop: NodePlopAPI): void {
  plop.setGenerator('python-service', {
    description: 'FastAPI Python service (uv + ruff + pytest + Dockerfile)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Service name (kebab-case, e.g. "rag"):',
        validate: (v: string) =>
          /^[a-z]([a-z0-9-]*[a-z0-9])?$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale Python service',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Dev port:',
        default: '8002',
        validate: (v: string) => {
          const port = parseInt(v, 10);
          return (
            (!isNaN(port) && port >= 1024 && port <= 65535) ||
            'Port must be 1024-65535'
          );
        },
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `services/{{kebabCase name}}`;
      const files = [
        'package.json.hbs',
        'pyproject.toml.hbs',
        'Dockerfile.hbs',
        'Dockerfile.dockerignore.hbs',
        'docker-entrypoint.sh.hbs',
        '.gitignore',
        'README.md.hbs',
        'app/__init__.py',
        'app/main.py.hbs',
        'tests/__init__.py',
        'tests/test_health.py.hbs',
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
