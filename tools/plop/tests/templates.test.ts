import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI, PlopGeneratorConfig } from 'plop';

import { registerPackage } from '../generators/package';
import { registerService } from '../generators/service';
import { registerSkill } from '../generators/skill';
import { registerTool } from '../generators/tool';

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, '../templates');

interface Answers {
  name: string;
  description: string;
  kind: string;
  port?: string;
  storybook?: boolean;
}

// Register a generator against a minimal mock plop so the actions it would run
// can be inspected — no filesystem writes, no interactive prompt layer.
function captureConfig(
  register: (plop: NodePlopAPI) => void,
): PlopGeneratorConfig {
  let captured: PlopGeneratorConfig | undefined;
  const mock = {
    setGenerator(_name: string, config: PlopGeneratorConfig) {
      captured = config;
      return config;
    },
  };
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- only setGenerator is exercised by the register functions
  register(mock as unknown as NodePlopAPI);
  if (!captured) throw new Error('generator never called setGenerator');
  return captured;
}

// Absolute path of every template file the generator's `add` actions reference
// for the given answers. Non-`add` actions (e.g. the skill "next steps" message
// function) carry no template and are skipped.
function templateFilesFor(
  config: PlopGeneratorConfig,
  answers: Answers,
): string[] {
  const actions: ActionType[] =
    typeof config.actions === 'function'
      ? config.actions(answers)
      : (config.actions ?? []);
  const files: string[] = [];
  for (const action of actions) {
    if (
      typeof action === 'object' &&
      action !== null &&
      'templateFile' in action &&
      typeof action.templateFile === 'string'
    ) {
      files.push(path.resolve(action.templateFile));
    }
  }
  return files;
}

// Binary assets can't be rendered through Handlebars, so the generators skip
// them by design; the orphan check excludes them.
const NON_EMITTABLE = /\.(png|ico|jpe?g|gif|webp)$/;

function listTemplateFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTemplateFiles(full));
    else out.push(path.resolve(full));
  }
  return out;
}

interface GenSpec {
  name: string;
  register: (plop: NodePlopAPI) => void;
  dir: string;
  // Answer combos that, together, must reference every emittable template file
  // under the category (so the orphan check sees storybook/variant files too).
  combos: Answers[];
}

const SPECS: GenSpec[] = [
  {
    name: 'package',
    register: registerPackage,
    dir: 'package',
    combos: [
      { name: 'x', description: 'd', kind: 'react', storybook: true },
      { name: 'x', description: 'd', kind: 'typescript' },
    ],
  },
  {
    name: 'service',
    register: registerService,
    dir: 'service',
    combos: [
      {
        name: 'x',
        description: 'd',
        kind: 'react',
        port: '3001',
        storybook: true,
      },
      { name: 'x', description: 'd', kind: 'docker' },
    ],
  },
  {
    name: 'tool',
    register: registerTool,
    dir: 'tool',
    combos: [
      { name: 'x', description: 'd', kind: 'typescript' },
      { name: 'x', description: 'd', kind: 'shell' },
    ],
  },
  {
    name: 'skill',
    register: registerSkill,
    dir: 'skill',
    combos: [
      { name: 'x', description: 'd', kind: 'typescript' },
      { name: 'x', description: 'd', kind: 'plain' },
    ],
  },
];

describe('plop generators stay in sync with their templates', () => {
  for (const spec of SPECS) {
    const config = captureConfig(spec.register);
    const referenced = new Set(
      spec.combos.flatMap((answers) => templateFilesFor(config, answers)),
    );

    test(`${spec.name}: every referenced template exists`, () => {
      expect(referenced.size).toBeGreaterThan(0);
      for (const file of referenced) {
        expect(
          existsSync(file),
          `generator points at a missing template: ${file}`,
        ).toBe(true);
      }
    });

    test(`${spec.name}: no emittable template is orphaned`, () => {
      const orphans = listTemplateFiles(
        path.join(templatesRoot, spec.dir),
      ).filter((file) => !NON_EMITTABLE.test(file) && !referenced.has(file));
      expect(
        orphans,
        `template files no generator emits:\n${orphans.join('\n')}`,
      ).toEqual([]);
    });
  }
});
