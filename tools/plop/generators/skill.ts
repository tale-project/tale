import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/skill');

type SkillKind = 'typescript' | 'python';

interface Answers {
  name: string;
  description: string;
  kind: SkillKind;
}

// Files scaffolded per kind. A SKILL.md + a runnable, skill-relative entry
// script (`bun scripts/main.ts` / `python scripts/main.py`); Python skills also
// get the package marker every skill scripts/ dir carries.
const FILES_BY_KIND: Record<SkillKind, string[]> = {
  typescript: ['SKILL.md.hbs', 'scripts/main.ts.hbs'],
  python: ['SKILL.md.hbs', 'scripts/main.py.hbs', 'scripts/__init__.py'],
};

export function registerSkill(plop: NodePlopAPI): void {
  plop.setGenerator('skill', {
    description:
      'Shared/product skill under skills/ (SKILL.md + runnable bundle; synced by @tale/skills)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Skill name (kebab-case):',
        validate: (v: string) =>
          /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ||
          'Use lowercase, dashes, no leading dash',
      },
      {
        type: 'input',
        name: 'description',
        message:
          'One-line description (this is the agent-facing invocation trigger):',
        default: 'What this skill does and when an agent should use it',
      },
      {
        type: 'list',
        name: 'kind',
        message: 'Skill code kind:',
        choices: [
          { name: 'TypeScript (run with bun)', value: 'typescript' },
          { name: 'Python (run with uv/python)', value: 'python' },
        ],
        default: 'typescript',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const dest = `skills/{{kebabCase name}}`;

      const actions: ActionType[] = FILES_BY_KIND[answers.kind].map((file) => {
        const isHbs = file.endsWith('.hbs');
        return {
          type: 'add',
          path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
          templateFile: `${templateDir}/${answers.kind}/${file}`,
          data: answers,
        };
      });

      // The manifest is typed TS (an `as const satisfies` array), so it is not
      // safe to machine-edit — remind the author to register the skill + sync.
      actions.push(
        () =>
          `\nNext steps:\n` +
          `  1. add { name: '${answers.name}', targets: [/* 'claude' and/or 'builtin' */] } to tools/skills/src/manifest.ts\n` +
          `  2. run \`bun run skills:sync\` to generate the .claude/skills + builtin-configs/skills copies and the cross-harness adapters`,
      );

      return actions;
    },
  });
}
