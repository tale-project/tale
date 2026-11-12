import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/service/manual');
const repoRoot = path.resolve(here, '../../..');

// The manual-test layer, identical for every unit and every repo: the guide,
// the environment, the suite shape, the registers a round consults and the
// round journal (AGENTS.md "Manual tests"). A new service is born with it
// (generators/service.ts, which adds its kind's starter suite); an existing
// unit acquires it through the `manual` generator below. One list, so the two
// never drift.
export const MANUAL_FILES = [
  'readme.md.hbs',
  'setup.md.hbs',
  'template.md.hbs',
  'reference/automation.md.hbs',
  'reference/not-a-finding.md.hbs',
  'reference/error-codes.md.hbs',
  'reference/pins.md.hbs',
  'runs/readme.md.hbs',
  'runs/template.md.hbs',
  'runs/template-session-log.md.hbs',
] as const;

/**
 * The `add` actions that render the layer into `<dest>/tests/manual/`. The
 * templates read `name`, `scope` (with `name`, the unit's package), `isReact`
 * (driven in a browser rather than as what it ships) and `port`.
 */
export function manualLayerActions(dest: string, view: object): ActionType[] {
  return MANUAL_FILES.map<ActionType>((file) => ({
    type: 'add',
    path: `${dest}/tests/manual/${file.replace(/\.hbs$/, '')}`,
    templateFile: path.join(templateDir, file),
    data: view,
  }));
}

/** A unit that can take a layer: where it is and the package it names. */
interface Unit {
  /** Repo-relative, e.g. `tools/cli`. */
  dir: string;
  /** `@tale` of `@tale/cli`. */
  scope: string;
  /** `cli` of `@tale/cli`. */
  name: string;
}

/** Repo-relative, lowercase and dashes, at least one level deep. */
const UNIT_PATH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

/**
 * The unit at `unit` under `root`, or the reason it cannot take a layer: it
 * must be a workspace (a `package.json` naming an `@scope/name` package) that
 * carries no `tests/manual/` yet — an existing layer is extended, never
 * overwritten.
 */
function readUnit(root: string, unit: string): Unit | string {
  const dir = unit.trim().replace(/\/+$/, '');
  if (!UNIT_PATH.test(dir)) {
    return 'Give the unit as a path from the repo root, in lowercase and dashes (e.g. tools/<name>)';
  }
  const manifest = path.join(root, dir, 'package.json');
  if (!existsSync(manifest)) {
    return `${dir} is not a workspace: it has no package.json`;
  }
  if (existsSync(path.join(root, dir, 'tests', 'manual'))) {
    return `${dir} already carries a manual layer (tests/manual); extend it instead`;
  }
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown })
      .name;
  } catch (error) {
    return `${dir}/package.json is not valid JSON: ${(error as Error).message}`;
  }
  const match = typeof name === 'string' ? PACKAGE_NAME.exec(name) : null;
  if (!match) {
    return `${dir}/package.json names no scoped package (@scope/name)`;
  }
  return { dir, scope: match[1], name: match[2] };
}

interface Answers {
  unit: string;
  /** A dev port, or `none`; absent from a scripted caller: `none`. */
  port?: string;
}

const NOT_IN_A_BROWSER = 'none';

function nextSteps(dir: string): string {
  return (
    `\nScaffolded ${dir}/tests/manual.\n\n` +
    `Next steps:\n` +
    `  1. write the unit's first suite under suites/ from template.md: its\n` +
    `     prefix in the header, then the boxes of behaviour it already ships\n` +
    `  2. in readme.md, list that suite in the suites table in place of the\n` +
    `     smoke row, and point the profiles and change-scoped rows at it\n` +
    `  3. fill setup.md with what a round needs before its first box\n` +
    `  4. run \`bun run lint:manual\` until it is green\n` +
    `  5. name the new layer where .agents/repo.md lists the manual layers`
  );
}

/**
 * `root` is the checkout the generator scaffolds into; tests point it at a
 * throwaway one. Output is anchored there, never at the plopfile's directory.
 */
export function registerManual(plop: NodePlopAPI, root = repoRoot): void {
  const unitOf = (value: string): Unit => {
    const unit = readUnit(root, value);
    if (typeof unit === 'string') throw new Error(unit);
    return unit;
  };

  plop.setGenerator('manual', {
    description:
      'Manual-test layer (tests/manual) for an existing unit that has none, like the one every new service is born with',
    prompts: [
      {
        type: 'input',
        name: 'unit',
        message: 'Unit (path from the repo root, e.g. tools/<name>):',
        validate: (v: string) => {
          const unit = readUnit(root, v);
          return typeof unit === 'string' ? unit : true;
        },
      },
      {
        // One answer carries the templates' `isReact` branch and its port: a
        // browser round runs a dev server and keeps devtools open; any other
        // unit is driven as what it ships. Unconditional (no `when`), so the
        // generator stays fully bypassable: `bun run gen:manual tools/x none`.
        type: 'input',
        name: 'port',
        message:
          'Dev port, if the unit is driven in a browser (a dev server and devtools); none otherwise:',
        default: NOT_IN_A_BROWSER,
        validate: (v: string) => {
          if (v === NOT_IN_A_BROWSER) return true;
          const port = Number(v);
          return (
            (/^\d+$/.test(v) && port >= 1 && port <= 65535) ||
            `Give a port (1–65535), or ${NOT_IN_A_BROWSER}`
          );
        },
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const unit = unitOf(answers.unit);
      const port = answers.port ?? NOT_IN_A_BROWSER;
      const view = {
        name: unit.name,
        scope: unit.scope,
        isReact: port !== NOT_IN_A_BROWSER,
        port,
      };
      return [
        ...manualLayerActions(path.join(root, unit.dir), view),
        () => nextSteps(unit.dir),
      ];
    },
  });
}
