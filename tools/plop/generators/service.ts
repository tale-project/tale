import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/service');

type ServiceKind = 'react' | 'docker';

interface Answers {
  name: string;
  description: string;
  kind: ServiceKind;
  port: string;
  storybook: boolean;
}

// Files scaffolded per kind, relative to templates/service/<kind>/. `react` is a
// TanStack Start frontend (Vite + Tailwind v4 + Vitest + Playwright, like
// services/web); `docker` is a pure-Docker service (like services/proxy).
// Binary assets (favicons) live in the template but are not scaffolded: plop
// renders every file through Handlebars, which would corrupt binary bytes.
const FILES_BY_KIND: Record<ServiceKind, string[]> = {
  react: [
    'package.json.hbs',
    'tsconfig.json.hbs',
    'vite.config.ts.hbs',
    'vitest.config.ts.hbs',
    'vitest.ui.config.ts.hbs',
    'playwright.config.ts.hbs',
    'tests/e2e/specs/smoke.spec.ts.hbs',
    'tailwind.config.ts.hbs',
    'postcss.config.mjs',
    'index.html.hbs',
    'vite-env.d.ts',
    'tsr.config.json',
    'Dockerfile.hbs',
    'Dockerfile.dockerignore.hbs',
    'docker-entrypoint.sh.hbs',
    '.gitignore',
    '.oxlintrc.json.hbs',
    'README.md.hbs',
    'server.ts.hbs',
    'app/main.tsx.hbs',
    'app/router.tsx.hbs',
    'app/globals.css',
    'app/locals.css',
    'app/routes/__root.tsx.hbs',
    'app/routes/index.tsx.hbs',
    'lib/i18n/client.tsx',
    'lib/i18n/i18n.ts.hbs',
    'lib/i18n/keys-dynamic.yml',
    'lib/i18n/messages.test.ts',
    'lib/i18n/types.ts',
    'messages/en.yml',
    'messages/de.yml',
    'messages/fr.yml',
    'messages/global.yml',
    'public/manifest.webmanifest.hbs',
    'types/.gitkeep',
  ],
  docker: [
    'package.json.hbs',
    'Dockerfile.hbs',
    'Dockerfile.dockerignore.hbs',
    'docker-entrypoint.sh.hbs',
    'entrypoint.sh.hbs',
    '.gitignore',
    'README.md.hbs',
  ],
};

// Storybook is React-only and opt-in.
const STORYBOOK_FILES = [
  '.storybook/main.ts.hbs',
  '.storybook/preview.tsx',
  '.storybook/manager.ts',
];

export function registerService(plop: NodePlopAPI): void {
  plop.setGenerator('service', {
    description:
      'Service under services/ (react = TanStack Start frontend like services/web; docker = pure-Docker service like services/proxy)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Service name (kebab-case, e.g. "web"):',
        validate: (v: string) =>
          /^[a-z]([a-z0-9-]*[a-z0-9])?$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
        default: 'Tale service',
      },
      {
        type: 'list',
        name: 'kind',
        message: 'Service kind:',
        choices: [
          {
            name: 'React frontend (TanStack Start + Vite + Tailwind)',
            value: 'react',
          },
          {
            name: 'Docker-only service (Dockerfile + entrypoint)',
            value: 'docker',
          },
        ],
        default: 'react',
      },
      {
        // Unconditional (no `when`) so the generator stays fully bypassable for
        // non-interactive / agent use. `port` and `storybook` are ignored
        // unless kind === 'react'.
        type: 'input',
        name: 'port',
        message: 'Dev port (react only, 3000–3999):',
        default: '3001',
        validate: (v: string) => {
          const port = parseInt(v, 10);
          return (port >= 3000 && port <= 3999) || 'Port must be 3000–3999';
        },
      },
      {
        type: 'confirm',
        name: 'storybook',
        message: 'Include Storybook? (react only)',
        default: false,
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `services/{{kebabCase name}}`;
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
