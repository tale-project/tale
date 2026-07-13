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
//   - local   -> .agents/skills/         Tale-specific repo-dev guide (docs).
//                Mirrored into .claude/skills/ by `bun run skills:sync`;
//                Cursor/Codex/Copilot read .agents/skills/ directly.
//   - project -> builtin-configs/skills/ product skill shipped to org agents
//                (embedded in the CLI binary + seeded per-org). Every product
//                skill except the document skills also adds its name to
//                PROJECTED_SKILLS in tools/skills/src/sync.ts, which projects
//                it into .agents/skills/ (and on to .claude/skills/).
//
// Both categories scaffold the same docs shape: SKILL.md + README, with any
// runnable code hand-added under `scripts/` (self-contained — the tools/skills
// guards enforce it). The one Bun-workspace skill under builtin-configs/skills/
// (visual-aspect-analyzer, additionally baked into the sandbox-runtime image)
// is a special case, not a scaffold target.
const DEST_ROOT: Record<SkillCategory, string> = {
  local: '.agents/skills',
  project: 'builtin-configs/skills',
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
    `  1. write builtin-configs/skills/${name}/SKILL.md and add any runnable code under ${name}/scripts/\n` +
    `  2. it ships to product agents from there (embedded in the CLI binary + seeded per-org)\n` +
    `  3. add "${name}" to PROJECTED_SKILLS in tools/skills/src/sync.ts (every non-document skill projects to the repo-dev guides) + an AGENTS.md row for a repo-dev workflow, then \`bun run skills:sync\`\n` +
    `  4. \`bun run skills:check\` verifies the projection and every \`bun|python scripts/…\` the SKILL.md references exists`
  );
}

export function registerSkill(plop: NodePlopAPI): void {
  plop.setGenerator('skill', {
    description:
      'Skill — local (.agents/skills, repo-dev guide) or project (builtin-configs/skills, shipped)',
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
            name: 'project — shipped product skill (builtin-configs/skills)',
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
