import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The suite runs one server per Playwright worker (`servers.ts`). What keeps a
// spec on ITS worker's server is that it never decides where to go: `baseURL`,
// the `request` fixture and the `server` fixture all say so. A spec that decides
// for itself fails the way it should not: quietly, on the first server, beside
// the worker that owns it. These rules hold the suite to that.

const E2E = import.meta.dirname;

interface Source {
  file: string;
  text: string;
}

function sources(directory: string): Source[] {
  return readdirSync(join(E2E, directory))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      file: `${directory}/${name}`,
      text: readFileSync(join(E2E, directory, name), 'utf8'),
    }));
}

const specs = sources('specs');
const helpers = sources('helpers');

function offenders(files: Source[], pattern: RegExp): string[] {
  return files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
}

describe('the specs and helpers of the Playwright suite', () => {
  it('find the specs and the helpers they are about', () => {
    expect(specs.length).toBeGreaterThan(5);
    expect(helpers.length).toBeGreaterThan(10);
  });

  it('take `test` from the fixtures, never from Playwright: its pages would all open the first server', () => {
    expect(
      offenders(
        specs,
        /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/,
      ),
    ).toEqual([]);
  });

  it('read no setting from the environment but in env.ts, which resolves the servers', () => {
    expect(
      offenders(
        [...specs, ...helpers].filter(({ file }) => file !== 'helpers/env.ts'),
        /process\.env/,
      ),
    ).toEqual([]);
  });

  it('name no port of the default servers: they ask the `server` fixture', () => {
    expect(
      offenders(
        [...specs, ...helpers],
        /\b(?:3204|4204)\b|(?:localhost|127\.0\.0\.1):[34]2\d\d\b/,
      ),
    ).toEqual([]);
  });
});

describe('the test server', () => {
  it('keeps no module-level state: its fakes, data directory and control server belong to one `startE2eServer` call', () => {
    for (const file of ['server.ts', 'control.ts']) {
      const text = readFileSync(join(E2E, file), 'utf8');
      expect(text, file).not.toMatch(/^(?:export )?(?:let|var)\s/m);
      expect(text, file).not.toMatch(
        /^(?:export )?const \w+ = (?:new \w+|mkdtempSync|Bun\.serve|startControlServer)/m,
      );
    }
  });
});
