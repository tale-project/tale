import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join } from 'node:path';

import {
  childEnvironment,
  phaseTimeout,
  processGroupSignaler,
} from './common.ts';

/** Private stdin is never copied into diagnostics. Both streams are bounded;
 * failures report only the executable name, never tool output or arguments. */
export async function runTlsTool(
  command: string,
  args: string[],
  input?: Buffer,
  allowedCodes = [0],
) {
  const timeout = phaseTimeout(15000);
  // Node's stdio "pipe" is a socket on Linux, so OpenSSL cannot reopen
  // /dev/stdin. A fixed POSIX pipeline provides an actual pipe; executable
  // and arguments remain positional values and private bytes stay on stdin.
  const spawnCommand = input === undefined ? command : '/bin/sh';
  const parameters =
    input === undefined
      ? args
      : ['-c', 'cat | exec "$@"', 'owned-tls-stdin', command, ...args];
  const child = spawn(spawnCommand, parameters, {
    env: childEnvironment(),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const signal = processGroupSignaler(child.pid);
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  let bytes = 0;
  let failed = false;
  let rejectCompletion: (error: Error) => void = () => {};
  const stop = () => {
    failed = true;
    try {
      signal('SIGKILL');
    } catch {
      rejectCompletion(new Error('TLS owned process could not be signaled'));
    }
  };
  const collect = (destination: Buffer[], chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 1_048_576) stop();
    else destination.push(chunk);
  };
  const completion = new Promise<number | null>((resolve, reject) => {
    rejectCompletion = reject;
    child.once('error', () => {
      failed = true;
    });
    child.once('close', resolve);
  });
  child.stdout.on('data', (chunk: Buffer) => collect(chunks, chunk));
  child.stderr.on('data', (chunk: Buffer) => collect(errors, chunk));
  child.stdin.on('error', () => {
    failed = true;
  });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const timer = setTimeout(stop, timeout);
  try {
    child.stdin.end(input);
    const code = await completion;
    assert(
      !failed && code !== null && allowedCodes.includes(code),
      `TLS command failed: ${basename(command)}`,
    );
    return {
      code,
      stdout: Buffer.concat(chunks).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8'),
    };
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    signal('SIGKILL');
  }
}

async function executable(name: string) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
    } catch (error) {
      if (
        ['ENOENT', 'EACCES', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        continue;
      throw error;
    }
    const resolved = await realpath(path);
    return {
      path: resolved,
      sha256: createHash('sha256')
        .update(await readFile(resolved))
        .digest('hex'),
    };
  }
  throw new Error(`Required TLS tool is unavailable: ${name}`);
}

function key() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
}

/** Only the returned leaf privateKey is secret: consumers must pass it in an
 * environment variable and serialize receipt alone. No host trust is changed. */
export async function prepareTls(
  directory: string,
  host: '127.0.0.2' | '127.0.0.1' = '127.0.0.2',
) {
  assert(isAbsolute(directory), 'TLS directory must be absolute');
  assert(
    host === '127.0.0.2' || host === '127.0.0.1',
    'TLS host must be the owned loopback address',
  );
  assert(
    process.platform === 'linux' || process.platform === 'darwin',
    'TLS preparation requires Linux or macOS',
  );
  phaseTimeout(1);
  // No recursive creation or reuse: the caller supplies a fresh owned child
  // beneath its preparation directory, and existing state is never touched.
  await mkdir(directory, { mode: 0o700 });
  const openssl = await executable('openssl');
  const certutil = await executable('certutil');
  const opensslVersion = (
    await runTlsTool(openssl.path, ['version'])
  ).stdout.trim();
  const packageTool = await executable(
    process.platform === 'linux' ? 'dpkg-query' : 'brew',
  );
  const nssPackageVersion = (
    await runTlsTool(
      packageTool.path,
      process.platform === 'linux'
        ? [
            '--show',
            '--showformat=${Package} ${Version}\n',
            'libnss3-tools',
            'libnss3',
          ]
        : ['list', '--versions', 'nss'],
    )
  ).stdout.trim();
  assert(nssPackageVersion, 'NSS package version is missing');
  const caPath = join(directory, 'ca.pem');
  const certificatePath = join(directory, 'server.pem');
  const csrPath = join(directory, 'server.csr');
  const extensionPath = join(directory, 'server-extensions.cnf');
  const nssDirectory = join(directory, 'nssdb');
  const caKey = key();
  const serverKey = key();
  const serial = `0x${randomBytes(16).toString('hex')}`;
  try {
    const ca = await runTlsTool(
      openssl.path,
      [
        'req',
        '-x509',
        '-new',
        '-key',
        '/dev/stdin',
        '-sha256',
        '-days',
        '1',
        '-subj',
        '/CN=Tale benchmark ephemeral CA',
        '-addext',
        'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
      ],
      caKey,
    );
    await writeFile(caPath, ca.stdout, { flag: 'wx', mode: 0o644 });
    const csr = await runTlsTool(
      openssl.path,
      ['req', '-new', '-key', '/dev/stdin', '-sha256', '-subj', `/CN=${host}`],
      serverKey,
    );
    await writeFile(csrPath, csr.stdout, { flag: 'wx', mode: 0o644 });
    await writeFile(
      extensionPath,
      `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${host}\n`,
      { flag: 'wx', mode: 0o644 },
    );
    const cert = await runTlsTool(
      openssl.path,
      [
        'x509',
        '-req',
        '-in',
        csrPath,
        '-CA',
        caPath,
        '-CAkey',
        '/dev/stdin',
        '-set_serial',
        serial,
        '-days',
        '1',
        '-sha256',
        '-extfile',
        extensionPath,
      ],
      caKey,
    );
    await writeFile(certificatePath, cert.stdout, { flag: 'wx', mode: 0o644 });
    const caCertificate = new X509Certificate(ca.stdout);
    const leaf = new X509Certificate(cert.stdout);
    assert(
      caCertificate.ca &&
        !leaf.ca &&
        caCertificate.verify(caCertificate.publicKey) &&
        leaf.verify(caCertificate.publicKey),
      'Synthetic certificate chain differs',
    );
    assert.equal(leaf.checkIP(host), host, 'Leaf IP SAN differs');
    assert.equal(
      leaf.subjectAltName,
      `IP Address:${host}`,
      'Unexpected leaf SAN',
    );
    const verification = await runTlsTool(openssl.path, [
      'verify',
      '-CAfile',
      caPath,
      '-purpose',
      'sslserver',
      '-verify_ip',
      host,
      certificatePath,
    ]);
    assert(
      verification.stdout.trim().endsWith(': OK'),
      'OpenSSL did not verify the owned leaf',
    );
    for (const certificate of [caCertificate, leaf]) {
      const before = Date.parse(certificate.validFrom);
      const after = Date.parse(certificate.validTo);
      assert(
        Number.isFinite(before) &&
          Number.isFinite(after) &&
          before <= Date.now() &&
          after > Date.now() &&
          after - before === 86400000,
        'Certificate must be valid for exactly one day',
      );
    }
    await mkdir(nssDirectory, { mode: 0o700 });
    await runTlsTool(certutil.path, [
      '-N',
      '--empty-password',
      '-d',
      `sql:${nssDirectory}`,
    ]);
    const nickname = 'tale-benchmark-ephemeral-ca';
    await runTlsTool(certutil.path, [
      '-A',
      '-d',
      `sql:${nssDirectory}`,
      '-n',
      nickname,
      '-t',
      'C,,',
      '-i',
      caPath,
    ]);
    const listing = (
      await runTlsTool(certutil.path, ['-L', '-d', `sql:${nssDirectory}`])
    ).stdout;
    const trustRows = listing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\s+[A-Za-z]*,[A-Za-z]*,[A-Za-z]*$/.test(line));
    assert(
      trustRows.length === 1 &&
        new RegExp(`^${nickname}\\s+C,,$`).test(trustRows[0] ?? ''),
      'NSS server CA trust differs',
    );
    const exported = await runTlsTool(certutil.path, [
      '-L',
      '-d',
      `sql:${nssDirectory}`,
      '-n',
      nickname,
      '-a',
    ]);
    assert.equal(
      new X509Certificate(exported.stdout).fingerprint256,
      caCertificate.fingerprint256,
      'NSS imported a different certificate',
    );
    const keys = await runTlsTool(
      certutil.path,
      ['-K', '-d', `sql:${nssDirectory}`],
      undefined,
      [255],
    );
    assert(
      /^certutil: no keys found$/im.test(`${keys.stdout}\n${keys.stderr}`),
      'NSS database must not contain private keys',
    );
    // pkcs11.txt can embed this preparation path. Only copy the public trust
    // DB and its verified empty key DB to the container's standard NSS path;
    // let NSS create its own module configuration at that destination.
    const nssFiles = await Promise.all(
      ['cert9.db', 'key4.db'].map(async (name) => ({
        name,
        sha256: createHash('sha256')
          .update(await readFile(join(nssDirectory, name)))
          .digest('hex'),
      })),
    );
    const receipt = {
      host,
      openssl: { ...openssl, version: opensslVersion },
      certutil: { ...certutil, packageVersion: nssPackageVersion, packageTool },
      ca: {
        fingerprint256: caCertificate.fingerprint256,
        validFrom: caCertificate.validFrom,
        validTo: caCertificate.validTo,
      },
      leaf: {
        fingerprint256: leaf.fingerprint256,
        subjectAltName: leaf.subjectAltName,
        serialNumber: leaf.serialNumber,
        validFrom: leaf.validFrom,
        validTo: leaf.validTo,
      },
      chainVerification: verification.stdout.trim(),
      nss: {
        directory: nssDirectory,
        nickname,
        trust: 'C,,',
        listing,
        privateKeys: false,
        files: nssFiles,
      },
    };
    return {
      privateKey: serverKey.toString('utf8'),
      certificatePath,
      caPath,
      nssDirectory,
      receipt,
    };
  } finally {
    caKey.fill(0);
    serverKey.fill(0);
  }
}
