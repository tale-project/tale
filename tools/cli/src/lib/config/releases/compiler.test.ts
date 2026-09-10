import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

import { unpack } from './archive';
import { assertBindings, assertNativeManifest } from './compiler';
import { buildRelease, verifyArtifact } from './release';
import { fixture } from './tests/fixture';

test('owned routing and mount paths change without altering code, data or neighboring slugs', async () => {
  const f = fixture('north-labs', ['invoice', 'invoice-tools'], ['pdf']);
  const code =
    'return { invoice: input.invoice, invoice_total: input.invoice_total, "invoice": "invoice" };';
  const document = {
    ...f.document,
    nodes: [
      ...f.document.nodes,
      {
        id: 'business',
        type: 'transform',
        code,
        input: { type: 'agent', skills: ['invoice'], invoice: 'invoice' },
      },
      { id: 'empty-agent', type: 'agent', prompt: 'No skills required.' },
      {
        id: 'path-agent',
        type: 'agent',
        skills: ['invoice', 'invoice-tools'],
        prompt:
          'Use ~/.claude/skills/invoice/scripts/run.py and /skills/invoice-tools. invoice invoice_total /skills/invoice_other /skills/invoice-tools-more stay data.',
        system: 'Load /skills/invoice/SKILL.md.',
      },
    ],
  };
  writeFileSync(path.join(f.pack, 'workflow.yml'), stringify(document));
  f.git('add', '--all');
  f.git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'routing regression',
  );
  const options = { ...f.options, sourceCommit: f.git('rev-parse', 'HEAD') };
  const release = await buildRelease(options);
  const entries = await unpack(release.bytes);
  const compiled = parse(
    entries
      .find((item) => item.path.endsWith('workflow.yml'))!
      .bytes.toString(),
  );
  const business = compiled.nodes.find(
    (node: { id: string }) => node.id === 'business',
  );
  expect(business.code).toBe(code);
  expect(business.input).toEqual({
    type: 'agent',
    skills: ['invoice'],
    invoice: 'invoice',
  });
  const agent = compiled.nodes.at(-1);
  expect(agent.skills).toEqual(['invoice-v2-3-4', 'invoice-tools-v2-3-4']);
  expect(agent.system).toBe('Load /skills/invoice-v2-3-4/SKILL.md.');
  expect(agent.prompt).toBe(
    'Use ~/.claude/skills/invoice-v2-3-4/scripts/run.py and /skills/invoice-tools-v2-3-4. invoice invoice_total /skills/invoice_other /skills/invoice-tools-more stay data.',
  );
  agent.system = 'Use /skills/invoice/SKILL.md';
  const manifest = { skills: release.manifest.skillSlugs };
  expect(() =>
    assertBindings(
      compiled,
      manifest,
      manifest.skills,
      release.manifest.skillBindings!,
      ['pdf'],
    ),
  ).toThrow('mutable logical skill mount');
  agent.system = '';
  compiled.nodes[1].input.skill = '{{ input.skill }}';
  expect(() =>
    assertBindings(
      compiled,
      manifest,
      manifest.skills,
      release.manifest.skillBindings!,
      ['pdf'],
    ),
  ).toThrow('declared immutable');
}, 30_000);

for (const external of [[], ['pdf']]) {
  test(`workflow-only release with ${external.length} external skills preserves empty strings without owner`, async () => {
    const f = fixture('plain-intake', [], external);
    writeFileSync(
      path.join(f.pack, 'workflow.yml'),
      stringify({ ...f.document, description: '', output: { invoice: '' } }),
    );
    f.git('add', '--all');
    f.git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'empty fields',
    );
    const options = {
      ...f.options,
      sourceCommit: f.git('rev-parse', 'HEAD'),
      skillOwnerUserId: undefined,
    };
    const release = await buildRelease(options);
    const entries = await unpack(release.bytes);
    const document = parse(
      entries
        .find((item) => item.path.endsWith('workflow.yml'))!
        .bytes.toString(),
    );
    expect(document.description).toBe('');
    expect(document.output).toEqual({ invoice: '' });
    expect(release.manifest.skillFiles).toEqual([]);
    expect(release.manifest.skillOwnerUserId).toBeUndefined();
    expect(
      (
        await verifyArtifact({
          ...options,
          manifestPath: path.join(f.directory, 'releases/2.3.4.json'),
          rebuild: true,
        })
      ).bytes,
    ).toEqual(release.bytes);
  }, 30_000);
}

test('native normalization and unsupported install behavior refuse before publication', async () => {
  const raw = {
    name: 'Intake',
    subjects: {
      task: { review: { requestChanges: true, unexpectedNestedField: true } },
    },
  };
  expect(() =>
    assertNativeManifest(raw, {
      name: 'Intake',
      subjects: { task: { review: { requestChanges: true } } },
    }),
  ).toThrow('normalization');
  assertNativeManifest(
    { name: 'Intake', hidden: false, triggers: [] },
    { name: 'Intake', hidden: false, triggers: [] },
  );
  for (const change of [
    { hidden: true },
    { triggers: [{ id: 'scheduler' }] },
  ]) {
    const f = fixture();
    writeFileSync(
      path.join(f.pack, 'automation.yml'),
      stringify({ ...f.metadata, ...change }),
    );
    f.git('add', '--all');
    f.git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'unsupported behavior',
    );
    await expect(
      buildRelease({ ...f.options, sourceCommit: f.git('rev-parse', 'HEAD') }),
    ).rejects.toThrow('native upload does not install');
  }
}, 30_000);
