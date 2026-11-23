// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { sourcePath, symbolicate } from './symbolicate';

/**
 * A two-source map: generated line 1 column 1 is `backend/env.ts` line 1
 * column 1, and generated line 1 column 11 is line 3 column 5 of a
 * dependency. (`AAAA` = first source, line 0, column 0; `UCEI` = ten
 * generated columns on, next source, two lines down, four columns in.)
 */
const MAP = {
  version: 3,
  sources: ['../backend/env.ts', '../../../node_modules/zod/v4/core/parse.js'],
  names: [],
  mappings: 'AAAA,UCEI',
};

const loadMap = (file: string): unknown => (file === 'main.js' ? MAP : null);

describe('reading a built stack trace back as source positions', () => {
  it('rewrites a named frame of a built file to its source file, line and column', () => {
    expect(
      symbolicate('    at KKo (file:///app/backend-dist/main.js:1:1)', loadMap),
    ).toBe('    at KKo (backend/env.ts:1:1)');
  });

  it('rewrites an anonymous frame, and one printed without the file scheme', () => {
    expect(
      symbolicate('    at file:///app/backend-dist/main.js:1:1', loadMap),
    ).toBe('    at backend/env.ts:1:1');
    expect(
      symbolicate('    at Tb (/app/backend-dist/main.js:1:1)', loadMap),
    ).toBe('    at Tb (backend/env.ts:1:1)');
  });

  it('names a dependency from node_modules on', () => {
    expect(
      symbolicate(
        '    at parse (file:///app/backend-dist/main.js:1:11)',
        loadMap,
      ),
    ).toBe('    at parse (node_modules/zod/v4/core/parse.js:3:5)');
  });

  it('leaves a frame of a file without a map, a node internal and the message as they are', () => {
    const trace = [
      'ZodError: expected string at path DATABASE_URL',
      '    at x (file:///app/backend-dist/chunk-abc123.js:4:20)',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)',
    ].join('\n');
    expect(symbolicate(trace, loadMap)).toBe(trace);
  });

  it('maps every frame of a trace and reads each map once', () => {
    let loads = 0;
    const counted = (file: string): unknown => {
      loads += 1;
      return loadMap(file);
    };
    expect(
      symbolicate(
        [
          'Error: boom',
          '    at a (file:///app/backend-dist/main.js:1:1)',
          '    at b (file:///app/backend-dist/main.js:1:11)',
        ].join('\n'),
        counted,
      ),
    ).toBe(
      [
        'Error: boom',
        '    at a (backend/env.ts:1:1)',
        '    at b (node_modules/zod/v4/core/parse.js:3:5)',
      ].join('\n'),
    );
    expect(loads).toBe(1);
  });

  it('passes a file whose map is not a source map through', () => {
    expect(
      symbolicate('    at a (file:///x/main.js:1:1)', () => ({ nope: true })),
    ).toBe('    at a (file:///x/main.js:1:1)');
  });
});

describe('a source reference as a path a reader can open', () => {
  it("starts the platform's own code at its tree", () => {
    expect(sourcePath('../backend/domains/tasks/service.ts')).toBe(
      'backend/domains/tasks/service.ts',
    );
    expect(sourcePath('../lib/engine/core/runner.ts')).toBe(
      'lib/engine/core/runner.ts',
    );
    expect(sourcePath('../../../packages/shared/src/db/serializable.ts')).toBe(
      'packages/shared/src/db/serializable.ts',
    );
  });

  it('starts a dependency at node_modules, the innermost one', () => {
    expect(sourcePath('../../../node_modules/a/node_modules/b/index.js')).toBe(
      'node_modules/b/index.js',
    );
  });
});
