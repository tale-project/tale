import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/skill');

type SkillKind = 'typescript' | 'plain';
type SkillCategory = 'local' | 'project' | 'integrated';

interface Answers {
  name: string;
  description: string;
  kind: SkillKind;
  category: SkillCategory;
}

// Where each category's source of truth lives (see AGENTS.md "Skills"):
//   - local      -> .agents/skills/         Tale-specific repo-dev guide (docs).
//                   Mirrored into .claude/skills/ by `bun run skills:sync`;
//                   Cursor/Codex/Copilot read .agents/skills/ directly.
//   - project    -> builtin-configs/skills/ product skill shipped to org agents
//                   (embedded in the CLI binary + seeded per-org). A GENERIC
//                   workflow skill that should ALSO guide repo-dev agents adds its
//                   name to WORKFLOW_SKILLS in tools/skills/src/sync.ts, which
//                   projects it into .agents/skills/ (and on to .claude/skills/).
//   - integrated -> skills/                 self-contained Bun workspace skill
//                   baked into the services/sandbox-runtime image.
const DEST_ROOT: Record<SkillCategory, string> = {
  local: '.agents/skills',
  project: 'builtin-configs/skills',
  integrated: 'skills',
};

// Files scaffolded per kind. `typescript` is a `skills/*` workspace: SKILL.md +
// README + package.json + tsconfig + a runnable, skill-relative `src/main.ts`
// entry, tested with `bun test` (co-located `src/*.test.ts`). `plain` is a
// docs-only skill — just SKILL.md + README, no code.
const FILES_BY_KIND: Record<SkillKind, string[]> = {
  typescript: [
    'SKILL.md.hbs',
    'README.md.hbs',
    'package.json.hbs',
    'tsconfig.json.hbs',
    '.gitignore',
    'src/main.ts.hbs',
    'src/main.test.ts.hbs',
  ],
  plain: ['SKILL.md.hbs', 'README.md.hbs'],
};

// Only `integrated` skills live under `skills/*` (a Bun workspace), so only they
// can be a `typescript` bundle. `local` (.agents/skills, repo-dev guides) and
// `project` (builtin-configs/skills, shipped product skills) are docs — and,
// where they need code, hand-added `scripts/` — never workspaces. They always
// scaffold the `plain` shape, ignoring `kind` (the same way `storybook`/`port`
// are ignored for the kinds that don't use them — kept unconditional so an agent
// can bypass every prompt non-interactively).
function effectiveKind(category: SkillCategory, kind: SkillKind): SkillKind {
  return category === 'integrated' ? kind : 'plain';
}

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
  if (category === 'project') {
    return (
      intro +
      `  1. write builtin-configs/skills/${name}/SKILL.md and add any runnable code under ${name}/scripts/\n` +
      `  2. it ships to product agents from there (embedded in the CLI binary + seeded per-org)\n` +
      `  3. GENERIC workflow skill that should also guide repo-dev agents? add "${name}" to WORKFLOW_SKILLS in tools/skills/src/sync.ts + its AGENTS.md row, then \`bun run skills:sync\` to project it into .agents/skills/\n` +
      `  4. \`bun run skills:check\` verifies the projection and every \`bun|python scripts/…\` the SKILL.md references exists`
    );
  }
  return (
    intro +
    `  1. build out skills/${name}/ (a Bun workspace: src/ entry + co-located \`bun test\`)\n` +
    `  2. to bake it into the sandbox image, add "${name}" to BAKED_BUILTIN_SKILLS (services/platform/convex/node_only/sandbox/integration_skills.ts) and COPY it in services/sandbox-runtime/Dockerfile`
  );
}

export function registerSkill(plop: NodePlopAPI): void {
  plop.setGenerator('skill', {
    description:
      'Skill — local (.agents/skills, repo-dev guide), project (builtin-configs/skills, shipped), or integrated (skills/, Bun workspace)',
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
          {
            name: 'integrated — Bun workspace baked into the sandbox (skills/)',
            value: 'integrated',
          },
        ],
        default: 'local',
      },
      {
        type: 'list',
        name: 'kind',
        message: 'Skill kind (integrated only; local/project are always docs):',
        choices: [
          { name: 'TypeScript (Bun workspace, bun test)', value: 'typescript' },
          { name: 'Plain (docs-only, SKILL.md + README)', value: 'plain' },
        ],
        default: 'plain',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const category = answers.category ?? 'local';
      const kind = effectiveKind(category, answers.kind ?? 'plain');
      const dest = `${DEST_ROOT[category]}/{{kebabCase name}}`;

      const actions: ActionType[] = FILES_BY_KIND[kind].map((file) => {
        const isHbs = file.endsWith('.hbs');
        return {
          type: 'add',
          path: `${dest}/${isHbs ? file.replace(/\.hbs$/, '') : file}`,
          templateFile: `${templateDir}/${kind}/${file}`,
          data: answers,
        };
      });

      actions.push(() => nextSteps(answers.name, category));
      return actions;
    },
  });
}
