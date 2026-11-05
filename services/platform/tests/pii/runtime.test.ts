// @vitest-environment node

/**
 * The PII patterns as the backend runs them: plain Node with the backend's
 * resolve hook (`backend/node-loader.mjs`), not vitest. A bundler's
 * CommonJS interop hid that `validator/lib/isIBAN` — CommonJS with a named
 * export beside its default — reached the IBAN pattern as its whole
 * `exports` object under Node: every IBAN validated false, and an
 * organization whose PII policy masks or blocks IBANs had none masked.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const loader = fileURLToPath(
  new URL('../../backend/node-loader.mjs', import.meta.url),
);
const pii = pathToFileURL(
  fileURLToPath(new URL('../../lib/pii/index.ts', import.meta.url)),
).href;
const dir = mkdtempSync(join(tmpdir(), 'tale-pii-runtime-'));
/** One line of each kind the patterns read, and lookalikes they must pass. */
const SAMPLES = [
  'Send to DE89370400440532013000 please',
  'Send to DE89370400440532013009 please',
  'contact me at alice@example.com today',
  'Tel: +44 20 7946 0123',
  'card 4111 1111 1111 1111 exp 12/29',
  'server at 192.168.10.24 answered',
  'no personal data in this sentence',
];
const CONFIG = {
  mode: 'mask',
  patterns: {
    email: true,
    phone: true,
    creditCard: true,
    iban: true,
    ipAddress: true,
  },
} as const;

writeFileSync(
  join(dir, 'entry.ts'),
  `import { createScrubber } from '${pii}';
const scrubber = createScrubber(${JSON.stringify(CONFIG)});
process.stdout.write(
  JSON.stringify(${JSON.stringify(SAMPLES)}.map((line) => scrubber.scrub(line))),
);
`,
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('PII patterns under the backend’s runtime', () => {
  it('scrubs exactly as the tests see it — an IBAN masked, its lookalike passed', async () => {
    // The Node that runs this test, when it is Node: a `node` found on the
    // PATH can be a shim for another runtime on a developer's machine.
    const node = process.versions.bun === undefined ? process.execPath : 'node';
    const result = spawnSync(
      node,
      [
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        '--import',
        loader,
        join(dir, 'entry.ts'),
      ],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env } },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const underNode: unknown[] = JSON.parse(result.stdout);
    const { createScrubber } = await import('../../lib/pii');
    const scrubber = createScrubber(CONFIG);
    expect(underNode).toEqual(SAMPLES.map((line) => scrubber.scrub(line)));
    expect(underNode[0]).toMatchObject({
      kind: 'modified',
      text: 'Send to [IBAN] please',
    });
    expect(underNode[1]).toMatchObject({ kind: 'pass' });
  });
});
