import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';
import type { ActionType, NodePlopAPI, PlopGeneratorConfig } from 'plop';

import { MANUAL_FILES, registerManual } from '../generators/manual';
import { registerService } from '../generators/service';
import { registerHelpers } from '../helpers';

/**
 * What a generator scaffolds must pass the gate that governs it — otherwise a
 * unit is born red and the person who scaffolded it did not cause it.
 *
 * This runs a generator's own actions into a throwaway checkout and runs the
 * REAL `bun run lint:manual` over it, as a subprocess, so the assertion is the
 * gate itself rather than a restatement of its rules.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const manualTemplates = path.resolve(here, '../templates/service/manual');

const handlebars = Handlebars.create();
registerHelpers({
  setHelper: (name: string, fn: Handlebars.HelperDelegate) =>
    handlebars.registerHelper(name, fn),
} as never);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway checkout holding `files` (repo-relative path → contents). */
function checkout(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'manual-scaffold-'));
  roots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

/** The config a register function hands plop, without a plop. */
function generator(
  register: (plop: NodePlopAPI) => void,
): PlopGeneratorConfig & { name: string } {
  let captured: (PlopGeneratorConfig & { name: string }) | undefined;
  register({
    setGenerator: (name: string, config: PlopGeneratorConfig) => {
      captured = { ...config, name };
      return config;
    },
  } as never);
  if (!captured) throw new Error('the generator was never registered');
  return captured;
}

function actionsOf(
  config: PlopGeneratorConfig,
  answers: Record<string, unknown>,
): ActionType[] {
  if (typeof config.actions !== 'function')
    throw new Error('expected dynamic actions');
  return config.actions(answers);
}

interface Add {
  path: string;
  templateFile: string;
  data: object;
}

function adds(actions: ActionType[]): Add[] {
  return actions.flatMap((action) =>
    typeof action === 'object' &&
    action.type === 'add' &&
    'path' in action &&
    typeof action.path === 'string' &&
    'templateFile' in action &&
    typeof action.templateFile === 'string'
      ? [
          {
            path: action.path,
            templateFile: path.resolve(action.templateFile),
            data: action.data ?? {},
          },
        ]
      : [],
  );
}

/**
 * Do what plop does with an `add`: render its path and its template with the
 * action's data, and write the file under `root` (a relative path is relative
 * to the checkout, as `bun run gen` passes `--dest .`).
 */
function write(root: string, add: Add): void {
  const target = path.resolve(
    root,
    handlebars.compile(add.path, { noEscape: true })(add.data),
  );
  mkdirSync(path.dirname(target), { recursive: true });
  const source = readFileSync(add.templateFile, 'utf8');
  writeFileSync(
    target,
    handlebars.compile(source, { noEscape: true })(add.data),
  );
}

/** Every file under a directory, relative to it. */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) return listFiles(path.join(dir, entry.name), rel);
    return [rel];
  });
}

function unrendered(dir: string): string[] {
  return listFiles(dir).flatMap((file) =>
    (
      readFileSync(path.join(dir, file), 'utf8').match(/\{\{.*?\}\}/g) ?? []
    ).map((tag) => `${file}: ${tag}`),
  );
}

function lintManual(root: string) {
  return spawnSync(
    'bun',
    [path.join(repoRoot, 'tools/lint-manual/cli.ts'), root],
    {
      encoding: 'utf8',
    },
  );
}

describe('a new service manual layer', () => {
  const service = generator(registerService);
  for (const kind of ['react', 'docker'] as const) {
    // The manual layer the service generator writes, starter suite included.
    const scaffold = (): string => {
      const root = checkout();
      const actions = actionsOf(service, {
        name: 'billing',
        description: 'Billing service',
        kind,
        port: '3001',
        storybook: false,
      });
      for (const add of adds(actions))
        if (add.path.includes('/tests/manual/')) write(root, add);
      return root;
    };
    const layer = (root: string) =>
      path.join(root, 'services', 'billing', 'tests', 'manual');

    test(`passes bun run lint:manual (${kind})`, () => {
      const gate = lintManual(scaffold());
      expect(`${kind}: ${gate.stderr}`).toBe(`${kind}: `);
      expect(gate.stdout).toContain('1 tree(s), 6 boxes');
      expect(gate.status).toBe(0);
    });

    test(`renders every handlebars tag (${kind})`, () => {
      expect(unrendered(layer(scaffold()))).toEqual([]);
    });

    test(`names the service's own package (${kind})`, () => {
      const setup = readFileSync(
        path.join(layer(scaffold()), 'setup.md'),
        'utf8',
      );
      expect(setup).toContain('bun run --filter @tale/billing ');
    });
  }
});

describe('the manual generator', () => {
  const PROBE = { 'tools/probe/package.json': '{ "name": "@acme/probe" }' };
  const answers = (unit: string, browser = false) => ({
    unit,
    port: browser ? '4321' : 'none',
  });
  const manualOf = (root: string) =>
    generator((plop) => registerManual(plop, root));

  test('is the `manual` generator', () => {
    expect(manualOf(checkout(PROBE)).name).toBe('manual');
  });

  test('renders the very layer a new service is born with', () => {
    const root = checkout(PROBE);
    const fromManual = adds(
      actionsOf(manualOf(root), answers('tools/probe')),
    ).map((add) => add.templateFile);
    const fromService = adds(
      actionsOf(generator(registerService), {
        name: 'billing',
        description: 'Billing service',
        kind: 'docker',
      }),
    )
      .map((add) => add.templateFile)
      .filter((file) => file.startsWith(`${manualTemplates}${path.sep}`));
    const shared = MANUAL_FILES.map((file) => path.join(manualTemplates, file));

    expect(fromManual).toEqual(shared);
    expect(fromService).toEqual(shared);
    // …and no shared template is left out of it.
    expect(
      listFiles(manualTemplates)
        .map((file) => path.join(manualTemplates, file))
        .sort(),
    ).toEqual([...shared].sort());
  });

  test("writes into the unit's tests/manual, under the checkout", () => {
    const root = checkout(PROBE);
    const targets = adds(
      actionsOf(manualOf(root), answers('tools/probe/')),
    ).map((add) => add.path);
    expect(targets).toEqual(
      MANUAL_FILES.map((file) =>
        path.join(root, 'tools/probe/tests/manual', file.replace(/\.hbs$/, '')),
      ),
    );
  });

  test('refuses a unit that cannot take a layer', () => {
    const root = checkout({
      ...PROBE,
      'tools/layered/package.json': '{ "name": "@acme/layered" }',
      'tools/layered/tests/manual/readme.md': '# Manual tests\n',
      'tools/unscoped/package.json': '{ "name": "unscoped" }',
      'tools/broken/package.json': '{ "name": ',
      'tools/bare/README.md': '# Not a workspace\n',
    });
    const { prompts } = manualOf(root);
    if (!Array.isArray(prompts)) throw new Error('expected static prompts');
    const validate = prompts.find((prompt) => prompt.name === 'unit')?.validate;
    if (!validate) throw new Error('the unit prompt validates nothing');

    for (const accepted of ['tools/probe', 'tools/probe/'])
      expect(validate(accepted), accepted).toBe(true);
    for (const [refused, reason] of [
      ['', 'from the repo root'],
      ['tools', 'from the repo root'],
      ['../tools/probe', 'from the repo root'],
      ['/tools/probe', 'from the repo root'],
      ['tools/../probe', 'from the repo root'],
      ['Tools/Probe', 'from the repo root'],
      ['tools/absent', 'no package.json'],
      ['tools/bare', 'no package.json'],
      ['tools/layered', 'already carries a manual layer'],
      ['tools/unscoped', 'no scoped package'],
      ['tools/broken', 'not valid JSON'],
    ])
      expect(validate(refused), refused).toContain(reason);
  });

  test('takes a port only for a unit driven in a browser', () => {
    const { prompts } = manualOf(checkout(PROBE));
    if (!Array.isArray(prompts)) throw new Error('expected static prompts');
    const port = prompts.find((prompt) => prompt.name === 'port');
    if (!port?.validate) throw new Error('the port prompt validates nothing');

    expect(port.default).toBe('none');
    for (const accepted of ['none', '1', '3004', '65535'])
      expect(port.validate(accepted), accepted).toBe(true);
    for (const refused of ['', '0', '65536', '30x', '-1', '3.5', 'None'])
      expect(port.validate(refused), refused).toContain('or none');
  });

  test('refuses an invalid unit when its prompt is bypassed, too', () => {
    const generatorFor = manualOf(checkout(PROBE));
    expect(() => actionsOf(generatorFor, answers('tools/absent'))).toThrow(
      'tools/absent is not a workspace',
    );
  });

  test("names the unit's own package, and its port only in a browser", () => {
    const setupOf = (browser: boolean): string => {
      const root = checkout(PROBE);
      for (const add of adds(
        actionsOf(manualOf(root), answers('tools/probe', browser)),
      ))
        write(root, add);
      const layer = path.join(root, 'tools/probe/tests/manual');
      expect(unrendered(layer)).toEqual([]);
      return readFileSync(path.join(layer, 'setup.md'), 'utf8');
    };

    const shipped = setupOf(false);
    expect(shipped).toContain('bun run --filter @acme/probe build');
    expect(shipped).not.toContain('localhost');
    const browser = setupOf(true);
    expect(browser).toContain('bun run --filter @acme/probe dev');
    expect(browser).toContain('http://localhost:4321');
  });

  test('leaves only what its next steps name for lint:manual to refuse', () => {
    const root = checkout(PROBE);
    const actions = actionsOf(manualOf(root), answers('tools/probe'));
    for (const add of adds(actions)) write(root, add);
    const steps = actions
      .filter((action) => typeof action === 'function')
      .map((action) => action({}, { type: 'next-steps' }, {} as never))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(steps).toContain('first suite under suites/');
    expect(steps).toContain('in place of the smoke row');

    // The scaffold alone: a layer with no suite yet, whose guide lists the
    // smoke suite a new service is born with. Nothing else.
    const bare = lintManual(root);
    const findings = bare.stderr
      .split('\n')
      .filter((line) => line.startsWith('  '));
    expect(findings).toEqual([
      '  tools/probe/tests/manual — missing `suites` — every manual root carries it',
      '  tools/probe/tests/manual/readme.md — the suites table links `suites/smoke.md`, which does not exist',
    ]);
    expect(bare.status).toBe(1);

    // Steps 1 and 2 done: the layer is green.
    const layer = path.join(root, 'tools/probe/tests/manual');
    mkdirSync(path.join(layer, 'suites'));
    writeFileSync(
      path.join(layer, 'suites/probe.md'),
      '# Probe\n\n> **Prefix** `PROBE-` · **Reset** none · **Cost** 1 min\n\n' +
        '- [ ] `PROBE-F1` · **Run `probe --version`** → it prints a version.\n',
    );
    const readme = path.join(layer, 'readme.md');
    writeFileSync(
      readme,
      readFileSync(readme, 'utf8')
        .replaceAll('[smoke](suites/smoke.md)', '[probe](suites/probe.md)')
        .replaceAll('(suites/smoke.md)', '(suites/probe.md)'),
    );
    const green = lintManual(root);
    expect(green.stderr).toBe('');
    expect(green.stdout).toContain('1 tree(s), 1 boxes');
    expect(green.status).toBe(0);
  });
});
