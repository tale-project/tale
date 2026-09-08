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

import { registerHelpers } from '../helpers';

/**
 * What the generator scaffolds must pass the gate that governs it — otherwise
 * a service is born red and the person who scaffolded it did not cause it.
 *
 * This renders the manual-layer templates into a throwaway checkout and runs
 * the REAL `bun run lint:manual` over it, as a subprocess, so the assertion is
 * the gate itself rather than a restatement of its rules.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const templateDir = path.resolve(here, '../templates/service');

const handlebars = Handlebars.create();
registerHelpers({
  setHelper: (name: string, fn: Handlebars.HelperDelegate) =>
    handlebars.registerHelper(name, fn),
} as never);

interface View {
  name: string;
  description: string;
  kind: 'react' | 'docker';
  port: string;
  isReact: boolean;
  isDocker: boolean;
}

const VIEWS: Record<string, View> = {
  react: {
    name: 'billing',
    description: 'Billing',
    kind: 'react',
    port: '3001',
    isReact: true,
    isDocker: false,
  },
  docker: {
    name: 'billing',
    description: 'Billing',
    kind: 'docker',
    port: '3001',
    isReact: false,
    isDocker: true,
  },
};

function render(file: string, view: View): string {
  const source = readFileSync(file, 'utf8');
  return handlebars.compile(source, { noEscape: true })(view);
}

/** Every `.hbs` under a directory, relative to it. */
function templates(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) return templates(path.join(dir, entry.name), rel);
    return entry.name.endsWith('.hbs') ? [rel] : [];
  });
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scaffold(view: View): string {
  const root = mkdtempSync(path.join(tmpdir(), 'manual-scaffold-'));
  const dest = path.join(root, 'services', view.name, 'tests', 'manual');
  const write = (from: string, to: string) => {
    const target = path.join(dest, to.replace(/\.hbs$/, ''));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, render(from, view));
  };
  const shared = path.join(templateDir, 'manual');
  for (const file of templates(shared)) write(path.join(shared, file), file);
  const kind = path.join(templateDir, view.kind, 'tests', 'manual');
  for (const file of templates(kind)) write(path.join(kind, file), file);
  return root;
}

describe('a scaffolded manual layer', () => {
  for (const [kind, view] of Object.entries(VIEWS)) {
    test(`passes bun run lint:manual (${kind})`, () => {
      const root = scaffold(view);
      roots.push(root);
      const gate = spawnSync(
        'bun',
        [path.join(repoRoot, 'tools/lint-manual/cli.ts'), root],
        { encoding: 'utf8' },
      );
      expect(`${kind}: ${gate.stderr}`).toBe(`${kind}: `);
      expect(gate.stdout).toContain('1 tree(s), 6 boxes');
      expect(gate.status).toBe(0);
    });

    test(`renders every handlebars tag (${kind})`, () => {
      const root = scaffold(view);
      roots.push(root);
      const dest = path.join(root, 'services', view.name, 'tests', 'manual');
      const unrendered = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return unrendered(full);
          const left = readFileSync(full, 'utf8').match(/\{\{.*?\}\}/g) ?? [];
          return left.map((tag) => `${entry.name}: ${tag}`);
        });
      expect(unrendered(dest)).toEqual([]);
    });
  }
});
