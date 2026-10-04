import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createApp } from '../../services/platform/server';
import { childEnvironment } from './browser/common.ts';
import { prepareTls, runTlsTool } from './browser/tls.ts';

const execute = promisify(execFile);
const owned = await mkdtemp(join(tmpdir(), 'tale-benchmark-tls-'));
let prepared: Awaited<ReturnType<typeof prepareTls>>;
let server: ReturnType<typeof Bun.serve>;
let port: number;
beforeAll(async () => {
  prepared = await prepareTls(join(owned, 'preparation'), '127.0.0.1');
  let handle = (_request: Request): Response | Promise<Response> =>
    new Response(null, { status: 503 });
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    tls: {
      key: prepared.privateKey,
      cert: await readFile(prepared.certificatePath),
    },
    fetch: (request) => handle(request),
  });
  port = server.port!;
  const origin = server.url.origin;
  const app = createApp(
    {
      SITE_URL: origin,
      SITE_ORIGINS: [origin],
      BASE_PATH: '',
      FILE_EVENTS_ENABLED: false,
      SENTRY_DSN: undefined,
      SENTRY_TRACES_SAMPLE_RATE: 0,
      TALE_VERSION: undefined,
      CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [],
    },
    {
      indexHtml:
        '<html><head></head><body><script>window.__ENV__ = "__ENV_PLACEHOLDER__";window.__ACCEPT_LANGUAGE__ = "__ACCEPT_LANGUAGE_PLACEHOLDER__";</script><main>Owned shell</main></body></html>',
      orgStorageOrigins: () => [],
      orgFrameAncestors: () => [],
    },
  );
  handle = (request) => app.fetch(request);
}, 30000);
afterAll(async () => {
  if (server) await server.stop(true);
  // Retain only public certificates/NSS DB and receipts in the owned temp
  // directory. No source or pre-existing state is removed by this proof.
});

async function client(
  ca?: string,
  servername?: string,
  path = '/api/health',
  method = 'GET',
) {
  const program = `import https from 'node:https';
const request=https.get({hostname:'127.0.0.1',port:${port},path:${JSON.stringify(path)},method:${JSON.stringify(method)},headers:{accept:'text/html','accept-language':'en'},${servername ? `servername:${JSON.stringify(servername)},` : ''}},response=>{let body='';response.on('data',c=>body+=c);response.on('end',()=>console.log(JSON.stringify({ok:true,status:response.statusCode,body,headers:response.headers})));});
request.on('error',error=>console.log(JSON.stringify({ok:false,code:error.code})));`;
  const result = await execute('node', ['--input-type=module', '-e', program], {
    env: childEnvironment(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}),
    timeout: 10000,
    maxBuffer: 65536,
  });
  return JSON.parse(result.stdout) as {
    ok: boolean;
    status?: number;
    code?: string;
    body?: string;
    headers?: Record<string, string>;
  };
}

test('fresh default Node rejects the CA; separately launched trusted Node succeeds with default verification', async () => {
  const untrusted = await client();
  expect(untrusted.ok).toBe(false);
  expect([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ]).toContain(untrusted.code ?? '');
  const trusted = await client(prepared.caPath);
  expect(trusted.ok).toBe(true);
  expect(trusted.status).toBe(200);
  expect(JSON.parse(trusted.body ?? '{}').status).toBe('ok');
  const wrongName = await client(prepared.caPath, 'not-the-fixture.invalid');
  expect(wrongName).toEqual({
    ok: false,
    code: 'ERR_TLS_CERT_ALTNAME_INVALID',
  });
});

test('fresh pinned Bun fetch refuses untrusted TLS and honors CA trust only in a separate child launch', async () => {
  expect(Bun.version).toBe('1.4.2');
  const program = `try {
    const response = await fetch(${JSON.stringify(`https://127.0.0.1:${port}/api/health`)}, { signal: AbortSignal.timeout(10000) });
    console.log(JSON.stringify({ok:true,status:response.status,runtime:process.versions.bun,body:await response.text()}));
  } catch (error) { console.log(JSON.stringify({ok:false,code:error?.cause?.code ?? error?.code,runtime:process.versions.bun})); }`;
  const launch = async (ca?: string) => {
    const result = await execute(process.execPath, ['-e', program], {
      env: childEnvironment(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}),
      timeout: 15000,
      maxBuffer: 65536,
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      code?: string;
      status?: number;
      runtime: string;
      body?: string;
    };
  };
  const untrusted = await launch();
  expect(untrusted.runtime).toBe('1.4.2');
  expect(untrusted.ok).toBe(false);
  expect([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_UNTRUSTED',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ]).toContain(untrusted.code ?? '');
  const trusted = await launch(prepared.caPath);
  expect(trusted.runtime).toBe('1.4.2');
  expect(trusted.ok).toBe(true);
  expect(trusted.status).toBe(200);
  expect(JSON.parse(trusted.body ?? '{}').status).toBe('ok');
});

test('unchanged production health HEAD and nonce/env shell work over the owned Bun TLS listener', async () => {
  const head = await client(prepared.caPath, undefined, '/api/health', 'HEAD');
  expect(head.ok).toBe(true);
  expect(head.status).toBe(200);
  expect(head.body).toBe('');
  expect(Number(head.headers?.['content-length'])).toBeGreaterThan(0);
  const shell = await client(prepared.caPath, undefined, '/');
  expect(shell.status).toBe(200);
  expect(shell.body).toContain(server.url.origin);
  expect(shell.body).not.toContain('__ENV_PLACEHOLDER__');
  expect(shell.body).not.toContain('__ACCEPT_LANGUAGE_PLACEHOLDER__');
  expect(shell.body).toMatch(/<script nonce="[^"]+"/);
  expect(shell.headers?.['content-security-policy']).toContain("'nonce-");
});

test('retains exact one-day CA/leaf identity, expected loopback SAN and verified tool provenance', async () => {
  const leaf = new X509Certificate(await readFile(prepared.certificatePath));
  const ca = new X509Certificate(await readFile(prepared.caPath));
  expect(leaf.verify(ca.publicKey)).toBe(true);
  expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1');
  expect(leaf.checkIP('127.0.0.2')).toBeUndefined();
  expect(leaf.subjectAltName).toBe('IP Address:127.0.0.1');
  expect(Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)).toBe(86400000);
  expect(prepared.receipt.leaf.fingerprint256).toBe(leaf.fingerprint256);
  expect(prepared.receipt.ca.fingerprint256).toBe(ca.fingerprint256);
  for (const tool of [prepared.receipt.openssl, prepared.receipt.certutil]) {
    expect(
      createHash('sha256')
        .update(await readFile(tool.path))
        .digest('hex'),
    ).toBe(tool.sha256);
  }
  expect(prepared.receipt.openssl.version).toContain('OpenSSL');
  expect(prepared.receipt.certutil.packageVersion.length).toBeGreaterThan(0);
});

test('only public CA trust and a verified empty key database survive relocation to a fresh NSS destination', async () => {
  const target = join(owned, 'relocated-nss');
  await mkdir(target, { mode: 0o700 });
  expect(prepared.receipt.nss.files.map((file) => file.name)).toEqual([
    'cert9.db',
    'key4.db',
  ]);
  for (const file of prepared.receipt.nss.files) {
    await copyFile(
      join(prepared.nssDirectory, file.name),
      join(target, file.name),
    );
    expect(
      createHash('sha256')
        .update(await readFile(join(target, file.name)))
        .digest('hex'),
    ).toBe(file.sha256);
  }
  expect(await readdir(target)).not.toContain('pkcs11.txt');
  const cert = await runTlsTool(prepared.receipt.certutil.path, [
    '-L',
    '-d',
    `sql:${target}`,
    '-n',
    prepared.receipt.nss.nickname,
    '-a',
  ]);
  expect(new X509Certificate(cert.stdout).fingerprint256).toBe(
    prepared.receipt.ca.fingerprint256,
  );
  const keys = await runTlsTool(
    prepared.receipt.certutil.path,
    ['-K', '-d', `sql:${target}`],
    undefined,
    [255],
  );
  expect(`${keys.stdout}\n${keys.stderr}`).toContain('no keys found');
});

test('public disk artifacts and serialized receipt contain no private key material', async () => {
  const inspect = async (directory: string) => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if ((await stat(path)).isDirectory()) await inspect(path);
      else {
        const bytes = await readFile(path);
        expect(/BEGIN (?:RSA )?PRIVATE KEY/.test(bytes.toString('utf8'))).toBe(
          false,
        );
        expect(bytes.includes(Buffer.from(prepared.privateKey))).toBe(false);
      }
    }
  };
  await inspect(owned);
  const receipt = JSON.stringify(prepared.receipt);
  expect(receipt.includes('PRIVATE KEY')).toBe(false);
  expect(receipt.includes(prepared.privateKey)).toBe(false);
});

test('refuses existing state, nonabsolute destinations and unowned host addresses', async () => {
  await expect(
    prepareTls(join(owned, 'preparation'), '127.0.0.1'),
  ).rejects.toThrow('EEXIST');
  await expect(prepareTls('relative', '127.0.0.1')).rejects.toThrow('absolute');
  // Runtime boundary remains enforced even when a JavaScript caller bypasses TS.
  await expect(
    prepareTls(join(owned, 'outside'), 'example.com' as '127.0.0.1'),
  ).rejects.toThrow('loopback');
});

test('command failures keep private stdin and tool diagnostics out of the thrown error', async () => {
  const marker = 'synthetic-secret-should-never-appear';
  const result = await runTlsTool(
    process.execPath,
    [
      '-e',
      "process.stdin.resume();process.stdin.on('data',x=>process.stderr.write(x));process.stdin.on('end',()=>process.exit(7))",
    ],
    Buffer.from(marker),
  ).then(
    () => 'unexpected success',
    (error: Error) => error.message,
  );
  expect(result).toContain('TLS command failed');
  expect(result).not.toContain(marker);
});

test('missing tools and excessive command output fail closed with bounded diagnostics', async () => {
  await expect(runTlsTool(join(owned, 'missing-tool'), [])).rejects.toThrow(
    'TLS command failed',
  );
  await expect(
    runTlsTool(join(owned, 'missing-tool'), [], Buffer.from('private-input')),
  ).rejects.toThrow('TLS command failed');
  await expect(
    runTlsTool(process.execPath, [
      '-e',
      // Keep this owned child alive so the assertion tests output-bound
      // termination, independently of platform exit/group-signal races.
      "process.stdout.write('x'.repeat(2097152));setInterval(()=>{},1000)",
    ]),
  ).rejects.toThrow('TLS command failed');
});

test('shared deadline kills the exact owned process and releases its listeners', async () => {
  const previous = process.env.BENCH_DEADLINE_MS;
  const pidPath = join(owned, 'deadline-process.pid');
  const signalListeners = [
    process.listenerCount('SIGINT'),
    process.listenerCount('SIGTERM'),
  ];
  process.env.BENCH_DEADLINE_MS = String(Date.now() + 400);
  try {
    await expect(
      runTlsTool(
        process.execPath,
        [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`,
        ],
        Buffer.from('synthetic-private-stdin'),
      ),
    ).rejects.toThrow('TLS command failed');
  } finally {
    if (previous === undefined) delete process.env.BENCH_DEADLINE_MS;
    else process.env.BENCH_DEADLINE_MS = previous;
  }
  const pid = Number(await readFile(pidPath, 'utf8'));
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow('ESRCH');
  expect([
    process.listenerCount('SIGINT'),
    process.listenerCount('SIGTERM'),
  ]).toEqual(signalListeners);
});

test('a signal error in the deadline callback rejects its owner without an uncaught exception', async () => {
  const previous = process.env.BENCH_DEADLINE_MS;
  const pidPath = join(owned, 'signal-error-process.pid');
  const originalKill = process.kill.bind(process);
  let refused = false;
  let cleanupError: unknown;
  const kill = spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 'SIGKILL' && !refused) {
      refused = true;
      throw Object.assign(new Error('synthetic denied signal'), {
        code: 'EPERM',
      });
    }
    return originalKill(pid, signal);
  });
  process.env.BENCH_DEADLINE_MS = String(Date.now() + 400);
  try {
    await expect(
      runTlsTool(process.execPath, [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`,
      ]),
    ).rejects.toThrow('TLS owned process could not be signaled');
  } finally {
    kill.mockRestore();
    if (previous === undefined) delete process.env.BENCH_DEADLINE_MS;
    else process.env.BENCH_DEADLINE_MS = previous;
    const pid = Number(await readFile(pidPath, 'utf8'));
    // The group signaler records one attempted signal, so failure must still
    // be surfaced; this test owns and explicitly reaps its synthetic child.
    try {
      originalKill(-pid, 'SIGKILL');
    } catch (error) {
      cleanupError = error;
    }
  }
  expect(refused).toBe(true);
  expect(
    cleanupError === undefined ||
      (cleanupError as NodeJS.ErrnoException).code === 'ESRCH',
  ).toBe(true);
});

test('private stdin transport preserves literal executable arguments without shell interpolation', async () => {
  const literal = 'literal $HOME $(printf forbidden) `printf forbidden` ; &';
  const result = await runTlsTool(
    process.execPath,
    [
      '-e',
      "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify(process.argv.slice(1))))",
      '--',
      literal,
    ],
    Buffer.from('synthetic-private-stdin'),
  );
  expect(JSON.parse(result.stdout)).toEqual([literal]);
  expect(result.stderr).toBe('');
});
