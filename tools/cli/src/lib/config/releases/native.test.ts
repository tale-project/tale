import { expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { parseAutomationPackZip } from '../../../../../../services/platform/backend/core/automations/pack_zip';
import { validate } from '../../../../../../services/platform/lib/engine/core/validate';
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
}, 30_000);

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
}, 30_000);

test('larger transform bodies survive native release emission and backend admission unchanged', async () => {
  const f = commandFixture('code-team', false);
  // Synthetic code exceeds both former expression-sized limits. Validation
  // compiles it only; the native validator's transport refuses all execution.
  const statements = Array.from(
    { length: 300 },
    (_, index) => `const value${index} = ${index};`,
  ).join('\n');
  const body = `${statements}\nreturn { count: value299 };`;
  const code = `/*${'x'.repeat(15_000 - body.length - 4)}*/${body}`;
  const document = {
    ...f.document,
    nodes: [{ id: 'work', type: 'transform', code }],
  };
  writeFileSync(path.join(f.pack, 'workflow.yml'), stringify(document));
  const release = await buildRelease({
    ...f.options,
    sourceCommit: f.commit(),
  });
  if (!release.installation) throw new Error('native installation missing');
  const emitted = await parseAutomationPackZip(
    release.installation.workflow.bytes,
  );
  expect(parse(emitted.document.text)).toEqual(document);
  // This is the same validator used by native upload/save/deploy, after the
  // real CLI ZIP projection, not a second permissive parser.
  expect(await validate(parse(emitted.document.text))).toEqual({
    errors: [],
    warnings: [],
  });
}, 30_000);

test('native normalization and unsupported catalogue fields are refused before publication', async () => {
  for (const [extra, refusal] of [
    [{ hidden: true }, 'native upload does not install hidden visibility'],
    [
      { triggers: [{ name: 'ignored' }] },
      'native upload does not install trigger declarations',
    ],
    // A field this CLI's schema does not know is named, so a pack written for
    // a newer Tale reads as exactly that.
    [
      {
        subjects: {
          task: {
            workflow: 'code-team-intake',
            review: { requestChanges: true, unexpected: true },
          },
        },
      },
      'native manifest normalization changes release semantics at subjects.task.review.unexpected;',
    ],
  ] as const) {
    const f = commandFixture('code-team', false);
    writeFileSync(
      path.join(f.pack, 'automation.yml'),
      stringify({ ...f.metadata, ...extra }),
    );
    await expect(
      buildRelease({ ...f.options, sourceCommit: f.commit() }),
    ).rejects.toThrow(refusal);
    expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
  }
}, 30_000);
