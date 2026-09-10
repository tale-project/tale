import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { buildRelease } from './release';
import { commandFixture } from './tests/command-fixture';

test('native admission registers embedded connectors and accepts a workflow-only client', async () => {
  for (const [client, owned] of [
    ['acme', true],
    ['north-labs', false],
  ] as const) {
    const f = commandFixture(client, owned);
    const result = await buildRelease(f.options);
    expect(result.manifest.skillSlugs.length).toBe(owned ? 1 : 0);
  }
});

test('native syntax errors are rejected before any immutable release is published', async () => {
  for (const node of [
    {
      id: 'work',
      type: 'transform',
      code: 'return (',
      expected: 'CODE_SYNTAX',
    },
    {
      id: 'work',
      type: 'transform',
      code: 'return 1;',
      when: '{{ input. }}',
      expected: 'EXPR_SYNTAX',
    },
  ]) {
    const f = commandFixture('code-team', false);
    const { expected, ...definition } = node;
    writeFileSync(
      path.join(f.pack, 'workflow.yml'),
      stringify({ ...f.document, nodes: [definition] }),
    );
    const sourceCommit = f.commit();
    await expect(buildRelease({ ...f.options, sourceCommit })).rejects.toThrow(
      expected,
    );
    expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
  }
});

test('native normalization and unsupported catalogue fields are refused before publication', async () => {
  for (const extra of [
    { hidden: true },
    { triggers: [{ name: 'ignored' }] },
    {
      subjects: {
        task: {
          workflow: 'code-team-intake',
          review: { requestChanges: true, unexpected: true },
        },
      },
    },
  ]) {
    const f = commandFixture('code-team', false);
    writeFileSync(
      path.join(f.pack, 'automation.yml'),
      stringify({ ...f.metadata, ...extra }),
    );
    await expect(
      buildRelease({ ...f.options, sourceCommit: f.commit() }),
    ).rejects.toThrow();
    expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
  }
});
