import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/video-episode');
const repoRoot = path.resolve(here, '../../..');
const episodesRoot = path.join(
  repoRoot,
  'services/platform/tests/docs-videos/episodes',
);

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface Answers {
  id: string;
  titleEn: string;
  episodeLabel: string;
  needsKnowledgeDb: boolean;
}

function nextSteps(id: string, dest: string): string {
  return (
    `\nScaffolded ${dest}.\n\n` +
    `Next steps (the produce-video skill owns the discipline):\n` +
    `  1. storyboard first — .agents/skills/produce-video/STORYBOARD.md;\n` +
    `     narration for ALL scenes in en, de, fr (write-translations voice),\n` +
    `     then a table read before any choreography\n` +
    `  2. a live-typed chat prompt? pair heroPromptByLocale with a match\n` +
    `     clause in services/platform/lib/mocks/overrides/docs-replies.ts\n` +
    `  3. bun run docs:videos -- --episode ${id} --stage check\n` +
    `  4. bun run docs:videos -- --episode ${id} --stage plan   # pacing\n` +
    `  5. rehearse free of billing: bun run docs:videos -- --episode ${id} --mock-tts\n` +
    `  6. real narration + take: bun run docs:videos -- --episode ${id} --locale all\n` +
    `  7. embed the mp4+vtt+poster set on the docs pages (write-docs) and\n` +
    `     tick the produce-video ship checklist before committing assets`
  );
}

export function registerVideoEpisode(plop: NodePlopAPI): void {
  plop.setGenerator('video-episode', {
    description:
      'Docs tutorial-video episode (services/platform/tests/docs-videos/episodes) — spec + choreography skeleton',
    prompts: [
      {
        type: 'input',
        name: 'id',
        message: 'Episode id (kebab-case, e.g. ep11-billing):',
        validate: (value: string) => {
          if (!ID_RE.test(value)) return 'Use lowercase kebab-case';
          if (existsSync(path.join(episodesRoot, value))) {
            return `episodes/${value} already exists`;
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'titleEn',
        message: 'English title (title card, e.g. "Billing and plans"):',
        validate: (value: string) =>
          value.trim().length > 0 || 'The title card needs a title',
      },
      {
        type: 'input',
        name: 'episodeLabel',
        message: 'Card eyebrow (e.g. "Episode 11"):',
        default: (answers: Partial<Answers>) => {
          const digits = /^ep(\d+)/.exec(answers.id ?? '')?.[1];
          return digits ? `Episode ${digits}` : 'Episode';
        },
      },
      {
        type: 'confirm',
        name: 'needsKnowledgeDb',
        message: 'Does a scene show Indexed badges (needs the RAG container)?',
        default: false,
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `services/platform/tests/docs-videos/episodes/${answers.id}`;
      const templateData = {
        ...answers,
        constName: answers.id.toUpperCase().replaceAll('-', '_'),
      };
      const actions: ActionType[] = [
        {
          type: 'add',
          path: `${dest}/episode.ts`,
          templateFile: `${templateDir}/episode.ts.hbs`,
          data: templateData,
        },
        {
          type: 'add',
          path: `${dest}/scenes.ts`,
          templateFile: `${templateDir}/scenes.ts.hbs`,
          data: templateData,
        },
      ];
      actions.push(() => nextSteps(answers.id, dest));
      return actions;
    },
  });
}
