import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/skill');

type SkillCategory = 'local' | 'project';

interface Answers {
  name: string;
  description: string;
  category: SkillCategory;
}

// Where each category's source of truth lives (see AGENTS.md "Skills"):
//   - local   -> .agents/skills/                 Tale-specific repo-dev guide
//                (docs). Mirrored into .claude/skills/ by `bun run skills:sync`;
//                Cursor/Codex/Copilot read .agents/skills/ directly.
//   - project -> configs/platform/custom/skills/ product skill shipped to org
//                agents. Its `<slug>/` bundle is catalog-scaffolded into every
//                org's `skills/` tree at org-create (the `skills` config domain
//                is `scaffoldKind: 'bundle'`); a runnable one (e.g.
//                visual-aspect-analyzer) is additionally baked into the
//                sandbox-runtime image.
//
// Both categories scaffold the same docs shape: SKILL.md + README, with any
// runnable code hand-added under `src/` (self-contained).
const DEST_ROOT: Record<SkillCategory, string> = {
  local: '.agents/skills',
  project: 'configs/platform/custom/skills',
};

// Files scaffolded for every skill: docs only — just SKILL.md + README.
const FILES = ['SKILL.md.hbs', 'README.md.hbs'];

function nextSteps(name: string, category: SkillCategory): string {
  const intro = `\nNext steps:\n`;
  if (category === 'local') {
    return (
      intro +
      `  1. write .agents/skills/${name}/SKILL.md (the repo-dev guide)\n` +
      `  2. run \`bun run skills:sync\` to mirror it into .claude/skills/ (Claude Code reads the mirror; Cursor/Codex/Copilot read .agents/skills/ directly)\n` +
      `  3. add its row to the skills index in AGENTS.md`
    );
  }
  return (
    intro +
    `  1. write configs/platform/custom/skills/${name}/SKILL.md and add any runnable code under ${name}/src/\n` +
    `  2. it seeds into every org's skills/ tree at org-create (the skills config domain is catalog-scaffolded)\n` +
    `  3. to run it inside a sandbox turn, bake the bundle into services/sandbox-runtime/Dockerfile (see visual-aspect-analyzer)`
  );
}

export function registerSkill(plop: NodePlopAPI): void {
  plop.setGenerator('skill', {
    description:
      'Skill — local (.agents/skills, repo-dev guide) or project (configs/platform/custom/skills, shipped)',
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
        name: 'category',
        message: 'Skill category:',
        choices: [
          {
            name: 'local — repo-dev guide (.agents/skills → mirrored to .claude/skills)',
            value: 'local',
          },
          {
            name: 'project — shipped product skill (configs/platform/custom/skills)',
            value: 'project',
          },
        ],
        default: 'local',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const category = answers.category ?? 'local';
      const dest = `${DEST_ROOT[category]}/{{kebabCase name}}`;

      const actions: ActionType[] = FILES.map((file) => ({
        type: 'add',
        path: `${dest}/${file.replace(/\.hbs$/, '')}`,
        templateFile: `${templateDir}/plain/${file}`,
        data: answers,
      }));

      actions.push(() => nextSteps(answers.name, category));
      return actions;
    },
  });
}
