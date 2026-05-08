import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/react-service');

interface Answers {
  name: string;
  description: string;
  port: string;
  storybook: boolean;
}

export function registerReactService(plop: NodePlopAPI): void {
  plop.setGenerator('react-service', {
    description:
      'TanStack Start React frontend service (Vite + Tailwind v4 + Storybook + Vitest)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Service name (kebab-case, e.g. "web"):',
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale frontend service',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Dev port (3000–3999):',
        default: '3001',
        validate: (v: string) => {
          const port = parseInt(v, 10);
          return (port >= 3000 && port <= 3999) || 'Port must be 3000–3999';
        },
      },
      {
        type: 'confirm',
        name: 'storybook',
        message: 'Include Storybook?',
        default: false,
      },
    ],
    actions: (data) => buildAddActions(data as Answers),
  });
}

const storybookFiles = [
  '.storybook/main.ts.hbs',
  '.storybook/preview.tsx',
  '.storybook/manager.ts',
  '.storybook/vitest.setup.ts',
];

const files = [
  'package.json.hbs',
  'tsconfig.json.hbs',
  'vite.config.ts.hbs',
  'vitest.config.ts.hbs',
  'vitest.ui.config.ts.hbs',
  'tailwind.config.ts.hbs',
  'postcss.config.mjs',
  'components.json',
  'index.html.hbs',
  'vite-env.d.ts',
  'tsr.config.json',
  'Dockerfile.hbs',
  'Dockerfile.dockerignore.hbs',
  'docker-entrypoint.sh.hbs',
  '.gitignore',
  '.oxlintrc.json',
  'README.md.hbs',
  'server.ts.hbs',
  'app/main.tsx.hbs',
  'app/router.tsx.hbs',
  'app/globals.css',
  'app/routes/__root.tsx.hbs',
  'app/routes/index.tsx.hbs',
  'lib/i18n/client.tsx',
  'lib/i18n/config.ts',
  'lib/i18n/i18n.ts.hbs',
  'lib/i18n/i18n-provider.tsx',
  'lib/i18n/keys-dynamic.txt',
  'lib/i18n/messages.test.ts',
  'lib/i18n/messages-usage.test.ts.hbs',
  'lib/i18n/types.ts',
  'messages/en.json',
  'messages/de.json',
  'messages/fr.json',
  'messages/global.json',
  'public/manifest.webmanifest.hbs',
  'public/robots.txt',
  'public/favicon.ico',
  'types/.gitkeep',
];

function buildAddActions(data: Answers): ActionType[] {
  const dest = `services/{{kebabCase name}}`;
  const include = data.storybook ? [...files, ...storybookFiles] : files;
  return include.map((file) => {
    const isHbs = file.endsWith('.hbs');
    return {
      type: 'add',
      path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
      templateFile: `${templateDir}/${file}`,
      data,
    };
  });
}
