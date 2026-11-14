// export-client: the credential export of a managed native client on the
// Incus runtime. The CLI copies the credentials out of the backend instance
// (`copyOut`, under its byte cap, design R-08) into private files: the client
// document, the consumer's environment and the receipt, each mode 0600 in a
// 0700 directory; the same command again is an exact replay.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  cli,
  currentRelease,
  deployed,
  expectCode,
  jsonOf,
  loadLab,
  prepared,
  record,
} from '../harness';

setDefaultTimeout(30 * 60_000);
const lab = loadLab();

describe('export-client', () => {
  // Off unless the lab declares the native client: README.md, "Known
  // findings", says what its creation does on the node today.
  test.skipIf(!lab.nativeClient)(
    'exports the declared native client to private files, and replays exactly',
    () => {
      deployed(lab);
      const bundle = prepared(lab, currentRelease(lab));
      const manifest = JSON.parse(
        readFileSync(join(bundle, 'deployment.json'), 'utf8'),
      ) as { cli: { revision: string }; deploymentRef: string };
      const output = join(lab.dir, 'exported-client');
      const args = [
        '--json',
        'deploy',
        'export-client',
        '--bundle',
        bundle,
        '--cli-ref',
        manifest.cli.revision,
        '--deployment-ref',
        manifest.deploymentRef,
        '--client',
        'e2e-portal',
        '--output',
        output,
        '--env-prefix',
        'E2E_PORTAL',
      ];
      const run = expectCode(cli(lab, args), 0);
      record(lab, 'export-client', { exportMs: run.ms });
      expect(statSync(output).mode & 0o777).toBe(0o700);
      for (const file of ['client.json', 'consumer-env.json', 'receipt.json'])
        expect(statSync(join(output, file)).mode & 0o777).toBe(0o600);
      const client = JSON.parse(
        readFileSync(join(output, 'client.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(JSON.stringify(client)).toContain('portal.lab.invalid');
      const consumer = JSON.parse(
        readFileSync(join(output, 'consumer-env.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(
        Object.keys(consumer).every((key) => key.startsWith('E2E_PORTAL')),
      ).toBe(true);
      // What the export printed names the files, never a credential.
      const printed = JSON.stringify(jsonOf(run));
      for (const value of Object.values(consumer))
        if (typeof value === 'string' && value.length >= 16)
          expect(printed).not.toContain(value);

      const files = ['client.json', 'consumer-env.json', 'receipt.json'];
      const before = files.map((file) => readFileSync(join(output, file)));
      const replay = expectCode(cli(lab, args), 0);
      record(lab, 'export-client', { replayMs: replay.ms });
      expect(files.map((file) => readFileSync(join(output, file)))).toEqual(
        before,
      );
    },
  );
});
