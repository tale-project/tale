// Functional health-only requests: no Tale page, module, font or task warming.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';

import { browserIdentity, launchBrowser } from './browser-identity.ts';
import { childEnvironment, json, outputPath, runLogged } from './common.ts';
import { browserOrigins } from './origins.mjs';

const identity = await browserIdentity();
const target = '/tmp/.pki/nssdb';
const source = process.env.BENCH_NSS_SOURCE!;
const ca = process.env.BENCH_TLS_CA!;
assert(source && ca);
const caCertificate = new X509Certificate(await readFile(ca));
const issuerName = /(?:^|\n)CN=([^\n]+)/.exec(caCertificate.subject)?.[1];
assert(issuerName, 'Synthetic CA has no issuer identity');
const receipt: Record<string, unknown> = {
  complete: false,
  browser: identity,
  requests: [],
  nssTarget: target,
  warming:
    'Only actual production /api/health, no application navigation or asset request',
};
await json('tls-proof.json', receipt);
try {
  await access(target).then(
    () => {
      throw new Error('Refuse preexisting NSS trust');
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  for (const executable of [process.execPath, '/tools/bun']) {
    for (const expected of ['untrusted', 'trusted']) {
      const name = `${executable === '/tools/bun' ? 'bun' : 'node'}-${expected}`;
      await runLogged(
        executable,
        [
          new URL('./tls-client.mjs', import.meta.url).pathname,
          browserOrigins[0]!,
          expected,
        ],
        {
          cwd: process.cwd(),
          log: outputPath(`tls-${name}.log`),
          timeoutMs: 15_000,
          env: childEnvironment(
            expected === 'trusted' ? { NODE_EXTRA_CA_CERTS: ca } : {},
          ),
        },
      );
    }
  }
  // No profile-directory trick: close the entire untrusted browser before
  // installing the CA in the existing child HOME's standard NSS location.
  const untrusted = await launchBrowser(identity);
  try {
    const page = await untrusted.newPage();
    let refused = false;
    try {
      await page.goto(`${browserOrigins[0]}/api/health`, { timeout: 15_000 });
    } catch (error) {
      assert(
        String(error).includes('ERR_CERT_AUTHORITY_INVALID'),
        `Expected certificate refusal, got ${String(error)}`,
      );
      refused = true;
    }
    assert(refused, 'Untrusted browser accepted synthetic TLS');
    receipt.untrustedBrowserRefused = true;
  } finally {
    await untrusted.close();
  }
  await mkdir('/tmp/.pki', { recursive: true, mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  const copied = [];
  for (const name of ['cert9.db', 'key4.db']) {
    const from = join(source, name);
    const to = join(target, name);
    await copyFile(from, to);
    const bytes = await readFile(to);
    assert.deepEqual(bytes, await readFile(from));
    copied.push({
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      uid: (await stat(to)).uid,
    });
    assert.equal((await stat(to)).uid, process.getuid!());
  }
  receipt.nssCopy = copied;
  const trusted = await launchBrowser(identity);
  try {
    const results = [];
    for (const origin of browserOrigins) {
      const page = await trusted.newPage();
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const response = await page.goto(`${origin}/api/health`, {
        timeout: 15_000,
      });
      assert(response);
      assert(response.ok());
      assert.equal(new URL(page.url()).origin, origin);
      const security = await response.securityDetails();
      assert(
        security &&
          typeof security.protocol === 'string' &&
          security.protocol.startsWith('TLS'),
      );
      assert.equal(
        security.issuer,
        issuerName,
        'Browser certificate issuer differs from the retained CA',
      );
      assert.deepEqual(
        errors,
        [],
        'Production health CSP/TLS emitted browser errors',
      );
      results.push({ origin, verified: true, security, errors });
      await page.close();
    }
    receipt.requests = results;
  } finally {
    await trusted.close();
  }
  receipt.nssFilesAfter = await readdir(target);
  receipt.complete = true;
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  await json('tls-proof.json', receipt);
}
