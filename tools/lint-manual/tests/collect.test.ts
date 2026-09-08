import { afterEach, describe, expect, test } from 'bun:test';

import { collect, findManualRoots } from '../src/collect';
import { MINIMAL, makeRepo } from './repo-fixture';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('collect', () => {
  test('finds every tests/manual tree, and reads it', () => {
    const fixture = makeRepo({
      ...MINIMAL,
      'services/worker/tests/manual/readme.md': '# Manual tests\n',
      'node_modules/pkg/tests/manual/readme.md': '# not ours\n',
      'services/app/dist/tests/manual/readme.md': '# built\n',
    });
    cleanup = fixture.cleanup;

    expect(findManualRoots(fixture.root)).toEqual([
      'services/app/tests/manual',
      'services/worker/tests/manual',
    ]);

    const repo = collect(fixture.root);
    expect(repo.roots).toHaveLength(2);
    const [app] = repo.roots;
    expect(app.suites.map((s) => s.name)).toEqual(['smoke.md']);
    expect(app.suites[0].boxes.map((b) => b.id)).toEqual(['SMOKE-1']);
    expect(app.readme?.text).toContain('## The suites');
    expect(app.referenceEntries).toContain('pins.md');
    expect(app.journal?.name).toBe('readme.md');
  });

  test('a partial tree reads as partial rather than throwing', () => {
    const fixture = makeRepo({
      'services/app/tests/manual/setup.md': '# Setup\n',
    });
    cleanup = fixture.cleanup;

    const [root] = collect(fixture.root).roots;
    expect(root.entries).toEqual(['setup.md']);
    expect(root.readme).toBeUndefined();
    expect(root.suites).toEqual([]);
    expect(root.reference).toEqual([]);
    expect(root.journal).toBeUndefined();
  });

  test('a checkout with no manual layer collects nothing', () => {
    const fixture = makeRepo({ 'README.md': '# repo\n' });
    cleanup = fixture.cleanup;
    expect(collect(fixture.root).roots).toEqual([]);
  });
});
