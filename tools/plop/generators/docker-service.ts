import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/docker-service');

interface Answers {
  name: string;
  description: string;
}

export function registerDockerService(plop: NodePlopAPI): void {
  plop.setGenerator('docker-service', {
    description: 'Pure-Docker service (mirrors services/db / services/proxy)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Service name (kebab-case):',
        validate: (v: string) =>
          /^[a-z]([a-z0-9-]*[a-z0-9])?$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale Docker-only service',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `services/{{kebabCase name}}`;
      const files = [
        'package.json.hbs',
        'Dockerfile.hbs',
        'Dockerfile.dockerignore.hbs',
        '.gitignore',
        'README.md.hbs',
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
