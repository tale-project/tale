import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { TALE_REPOSITORY, withDeploymentSources } from './sources';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const revision = 'b'.repeat(40);
const client = { repository: 'https://github.com/north-labs/desk', revision };
const runtime = { repository: TALE_REPOSITORY, revision };
const success = (stdout = '') => ({
  stdout,
  stderr: '',
  exitCode: 0,
  success: true,
});

function syntheticKey() {
  const root = mkdtempSync(join(tmpdir(), 'tale-source-ssh-test-'));
  roots.push(root);
  const file = join(root, 'synthetic-key');
  execFileSync(
    'ssh-keygen',
    [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      'synthetic-source-test',
      '-f',
      file,
    ],
    { stdio: 'pipe', timeout: 5000 },
  );
  return { file, contents: readFileSync(file, 'utf8') };
}

const publicKey = (file: string) =>
  execFileSync('ssh-keygen', ['-y', '-P', '', '-f', file], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5000,
  });

// Managed source preparation requires a POSIX host. Check the actual OpenSSH
// parser and its private-file permissions on both supported CI host families.
const testPosix = test.skipIf(process.platform === 'win32');
for (const variant of ['LF', 'missing LF', 'CRLF', 'CRLF missing LF']) {
  testPosix(
    `private source acquisition preserves the OpenSSH key identity with ${variant}`,
    async () => {
      const original = syntheticKey();
      const expectedPublicKey = publicKey(original.file);
      const lineEndings = variant.startsWith('CRLF')
        ? original.contents.replaceAll('\n', '\r\n')
        : original.contents;
      const sourceKey = variant.includes('missing')
        ? lineEndings.replace(/[\r\n]+$/, '')
        : lineEndings;
      let keyFile = '';
      let privateFetches = 0;
      let publicFetches = 0;
      await withDeploymentSources(
        [client, runtime],
        {
          sourceKey,
          fetchImpl: async () =>
            Response.json({
              ssh_keys: [
                expectedPublicKey.trim().split(' ').slice(0, 2).join(' '),
              ],
            }),
          run: async (command, args, options) => {
            expect(command).toBe('git');
            expect(options?.silent).toBe(true);
            expect(options?.env).not.toHaveProperty('TALE_SOURCE_SSH_KEY');
            expect(JSON.stringify(options?.env)).not.toContain(sourceKey);
            if (args.includes('fetch')) {
              const ssh = options?.env?.GIT_SSH_COMMAND;
              if (ssh) {
                privateFetches++;
                keyFile = /'-i' '([^']+)'/.exec(ssh)?.[1] ?? '';
                expect(ssh).toContain('StrictHostKeyChecking=yes');
                expect(ssh).toContain('IdentitiesOnly=yes');
                expect(ssh).toContain('BatchMode=yes');
                expect(statSync(keyFile).mode & 0o777).toBe(0o600);
                expect(statSync(dirname(keyFile)).mode & 0o777).toBe(0o700);
                // Parsing the actual temporary file catches missing terminal LF;
                // comparing public keys proves the key itself was not changed.
                expect(publicKey(keyFile)).toBe(expectedPublicKey);
                expect(readFileSync(keyFile, 'utf8')).toBe(original.contents);
              } else {
                publicFetches++;
                expect(options?.env).not.toHaveProperty('GIT_SSH_COMMAND');
              }
            }
            return success(args.includes('rev-parse') ? revision : '');
          },
        },
        async (source) => {
          expect(existsSync(source(client))).toBe(true);
          expect(existsSync(source(runtime))).toBe(true);
          expect(existsSync(keyFile)).toBe(true);
        },
      );
      expect(privateFetches).toBe(1);
      expect(publicFetches).toBe(1);
      expect(existsSync(keyFile)).toBe(false);
      expect(existsSync(dirname(keyFile))).toBe(false);
      expect(readFileSync(original.file, 'utf8')).toBe(original.contents);
    },
    30_000,
  );
}

test('public runtime source acquisition does not stage or use a client key', async () => {
  const sourceKey = 'unused-private-source-marker';
  let root = '';
  await withDeploymentSources(
    [runtime],
    {
      sourceKey,
      fetchImpl: () => {
        throw new Error('public source must not request SSH metadata');
      },
      run: async (_command, args, options) => {
        expect(options?.env).not.toHaveProperty('GIT_SSH_COMMAND');
        expect(options?.env).not.toHaveProperty('TALE_SOURCE_SSH_KEY');
        expect(JSON.stringify(options?.env)).not.toContain(sourceKey);
        return success(args.includes('rev-parse') ? revision : '');
      },
    },
    async (source) => {
      root = dirname(source(runtime));
      expect(existsSync(join(root, 'source-key'))).toBe(false);
      expect(existsSync(join(root, 'known-hosts'))).toBe(false);
    },
  );
  expect(existsSync(root)).toBe(false);
});
