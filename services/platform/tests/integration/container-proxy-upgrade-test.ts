#!/usr/bin/env bun
// =============================================================================
// Tale — Proxy Upgrade Test (the Caddy edge to the Traefik edge)
// =============================================================================
// Starts from the compose state and volumes of a Tale 0.5 install, whose edge
// was Caddy, replaces its proxy with the Traefik edge the way `docker compose
// up` does, and proves the install goes on serving its domain over HTTPS with
// the certificates it had (services/proxy/render/caddy.js):
//
//   self-signed    Caddy makes its own local CA; Traefik's answer verifies
//                  against that root alone, and the previous release serves
//                  again on the same volume (the rollback).
//   Let's Encrypt  a certificate stored where Caddy keeps one is the one
//                  Traefik serves, with no ACME account and no order.
//
// Both prove the Caddy volume byte for byte as it was. No request leaves the
// runner: both edges send their outbound HTTPS to a closed local port.
//
// Usage:
//   bun services/platform/tests/integration/container-proxy-upgrade-test.ts
//   bun run docker:test:proxy-upgrade
//
// Environment variables:
//   PULL_POLICY    - 'never' takes the proxy image as it is (CI); unset
//                    builds it
//   KEEP_RUNNING   - Set to 'true' to skip teardown (for debugging)
// =============================================================================
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { caddyCa, serverCert } from '../../../proxy/render/caddy-fixture';
import {
  Compose,
  composeArgs,
  nowSec,
  recreateNetwork,
  removeNetwork,
  sleep,
} from './lib/docker';
import { capture, projectRoot } from './lib/exec';
import { header, NC, Results, YELLOW } from './lib/log';
import { rawTlsRequest } from './lib/tls';

const PROJECT_ROOT = projectRoot();
const PROJECT = 'tale-upgrade-test';
const HOST = 'tale.upgrade.test';
const HTTPS_PORT = 10443;
const WAIT_SEC = 120;
const SANDBOX_NET = 'tale-sandbox-net';
// The edge of Tale 0.5.97, whose proxy is Caddy like that of every 0.5 release.
const CADDY_IMAGE =
  'ghcr.io/tale-project/tale/tale-proxy:0.5.97@sha256:50ba40da57a3c49d457f40ebee0d3375d943a1da11e95355d0666072dde6c79e';
const CADDY_DATA = `${PROJECT}_caddy-data`;
const CADDY_ROOT = '/data/caddy/pki/authorities/local/root.crt';
const CADDY_LETS_ENCRYPT = `/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${HOST}`;
// What Traefik logs when its resolver orders, renews or cannot.
const ACME_ACTIVITY = [
  'Unable to obtain ACME certificate',
  'cannot get ACME client',
  'Error renewing ACME certificate',
  'Renewing ACME certificate',
];

const dir = mkdtempSync(join(tmpdir(), 'tale-proxy-upgrade-'));
const caddyFile = join(dir, 'caddy-edge.yml');
const siteFile = join(dir, 'site.yml');

// The proxy service of Tale 0.5.97's compose.yml, published on the test ports.
writeFileSync(
  caddyFile,
  `services:
  proxy:
    image: ${CADDY_IMAGE}
    container_name: tale-proxy
    ports:
      - '10080:80'
      - '${HTTPS_PORT}:443'
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    environment:
      BACKEND_UPSTREAM: backend-api:3005
      OBJECT_STORE_BUCKET: tale-blobs
      OBJECT_STORE_UPSTREAM: object-store:9000
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:2020/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  caddy-data:
  caddy-config:
`,
);

const caddyEdge = new Compose(
  composeArgs({ files: [caddyFile, siteFile], project: PROJECT }),
  PROJECT_ROOT,
);
const traefikEdge = new Compose(
  composeArgs({
    files: ['compose.yml', 'compose.test.yml', siteFile],
    envFile: '.env.test',
    project: PROJECT,
  }),
  PROJECT_ROOT,
);

const r = new Results();

/** The install's own settings, for both edges: its domain and TLS mode. */
function writeSite(mode: 'selfsigned' | 'letsencrypt'): void {
  writeFileSync(
    siteFile,
    `services:
  proxy:
    environment:
      HOST: ${HOST}
      SITE_URL: https://${HOST}
      TLS_MODE: ${mode}
      TLS_EMAIL: ops@${HOST}
      # A closed port: no ACME request reaches a real issuer.
      HTTPS_PROXY: http://127.0.0.1:9
`,
  );
}

const request = (path: string) =>
  `GET ${path} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`;

/**
 * Asks the edge for `path` over HTTPS for HOST, verified against `ca` alone,
 * until `accept` takes the answer or WAIT_SEC passed. Answers whether it did,
 * and the last answer or error.
 */
async function serves(
  ca: string,
  path: string,
  accept: (response: string) => boolean,
): Promise<{ ok: boolean; last: string }> {
  const start = nowSec();
  let last = '';
  while (nowSec() - start < WAIT_SEC) {
    const { response, error } = await rawTlsRequest({
      port: HTTPS_PORT,
      servername: HOST,
      ca,
      request: request(path),
    });
    if (accept(response)) return { ok: true, last: response };
    last = error ?? response.split('\r\n')[0] ?? '';
    await sleep(2_000);
  }
  return { ok: false, last };
}

const anyAnswer = (response: string) => response.startsWith('HTTP/1.1 ');
const healthy = (response: string) =>
  response.startsWith('HTTP/1.1 200 ') && response.includes('\r\n\r\nOK');

/** A file of the running proxy container, or '' while it has none. */
async function proxyFile(path: string): Promise<string> {
  const { stdout, exitCode } = await capture([
    'docker',
    'exec',
    'tale-proxy',
    'cat',
    path,
  ]);
  return exitCode === 0 ? stdout : '';
}

async function proxyLogs(): Promise<string> {
  return (await capture(['docker', 'logs', 'tale-proxy'])).combined;
}

/** Every entry of a volume with its mode, owner, size and time, and every file's hash. */
async function volumeDigest(volume: string): Promise<string> {
  const { stdout, stderr, exitCode } = await capture([
    'docker',
    'run',
    '--rm',
    '--network',
    'none',
    '--volume',
    `${volume}:/volume:ro`,
    '--entrypoint',
    'sh',
    CADDY_IMAGE,
    '-c',
    'cd /volume && find . -exec stat -c "%n %a %u:%g %s %Y" {} + | sort && find . -type f -exec sha256sum {} + | sort',
  ]);
  if (exitCode !== 0) throw new Error(`${volume} cannot be read: ${stderr}`);
  return stdout;
}

/** Writes `content` to `path` in a volume, private as Caddy keeps its files. */
async function plant(
  volume: string,
  path: string,
  content: string,
): Promise<void> {
  const { stderr, exitCode } = await capture(
    [
      'docker',
      'run',
      '--rm',
      '-i',
      '--network',
      'none',
      '--volume',
      `${volume}:/data`,
      '--entrypoint',
      'sh',
      CADDY_IMAGE,
      '-c',
      `umask 077 && mkdir -p "$(dirname '${path}')" && cat > '${path}'`,
    ],
    { stdin: content },
  );
  if (exitCode !== 0) throw new Error(`${path} cannot be written: ${stderr}`);
}

/** The certificates of a PEM text, each as its base64 body. */
const certificates = (pem: string): string[] =>
  [
    ...pem.matchAll(
      /-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/g,
    ),
  ].map((match) => (match[1] ?? '').replace(/\s/g, ''));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Proves the volume unchanged since `before` was taken. */
async function checkUntouched(before: string): Promise<void> {
  const after = await volumeDigest(CADDY_DATA);
  if (after === before) {
    r.pass('The Caddy volume is byte for byte as it was');
  } else {
    console.log(`  Before:\n${before}\n  After:\n${after}`);
    r.fail('The Caddy volume is byte for byte as it was');
  }
}

/** Replaces the running edge with the Traefik edge, as an upgrade does. */
async function upgrade(): Promise<boolean> {
  header('Upgrading to the Traefik edge');
  const code = await traefikEdge.run([
    'up',
    '-d',
    '--no-deps',
    'proxy',
    'docker-api',
  ]);
  if (code !== 0) r.fail(`The Traefik edge starts (exit ${code})`);
  return code === 0;
}

async function selfSigned(): Promise<void> {
  header('Self-signed: the Caddy edge makes its local CA');
  writeSite('selfsigned');
  if ((await caddyEdge.run(['up', '-d', 'proxy'])) !== 0) {
    r.fail('The Caddy edge starts');
    return;
  }
  let root = '';
  for (const start = nowSec(); !root && nowSec() - start < WAIT_SEC;) {
    const text = await proxyFile(CADDY_ROOT);
    if (text.includes('BEGIN CERTIFICATE')) root = text;
    else await sleep(2_000);
  }
  if (!root) {
    r.fail('The Caddy edge writes its local CA');
    return;
  }
  const before = await serves(root, '/', anyAnswer);
  if (!before.ok) {
    r.fail(`The Caddy edge serves ${HOST} with its local CA: ${before.last}`);
    return;
  }
  r.pass(`The Caddy edge serves ${HOST} with its local CA`);
  await caddyEdge.run(['stop', 'proxy']);
  const digest = await volumeDigest(CADDY_DATA);

  if (!(await upgrade())) return;
  const after = await serves(root, '/health', healthy);
  if (after.ok) {
    r.pass(`The Traefik edge serves ${HOST} under the Caddy root`);
  } else {
    r.fail(
      `The Traefik edge serves ${HOST} under the Caddy root: ${after.last}`,
    );
  }
  if (
    (await proxyLogs()).includes('TLS: adopted the local CA of the Caddy proxy')
  ) {
    r.pass('The Traefik edge says it adopted the Caddy CA');
  } else {
    r.fail('The Traefik edge says it adopted the Caddy CA');
  }
  const adopted = certificates(await proxyFile('/data/pki/root.crt'));
  if (adopted.length === 1 && adopted[0] === certificates(root)[0]) {
    r.pass('The root to trust is the Caddy root (/data/pki/root.crt)');
  } else {
    r.fail('The root to trust is the Caddy root (/data/pki/root.crt)');
  }
  await checkUntouched(digest);

  header('Self-signed: rolling back to the Caddy edge');
  if ((await caddyEdge.run(['up', '-d', 'proxy'])) !== 0) {
    r.fail('The Caddy edge starts again');
    return;
  }
  const rollback = await serves(root, '/', anyAnswer);
  if (rollback.ok) {
    r.pass(`The rolled-back Caddy edge serves ${HOST} with its local CA`);
  } else {
    r.fail(
      `The rolled-back Caddy edge serves ${HOST} with its local CA: ${rollback.last}`,
    );
  }
}

async function letsEncrypt(): Promise<void> {
  header("Let's Encrypt: a certificate where the Caddy edge keeps it");
  writeSite('letsencrypt');
  // Created, never started: the Caddy edge would order from Let's Encrypt.
  if ((await caddyEdge.run(['create', 'proxy'])) !== 0) {
    r.fail('The Caddy edge is created');
    return;
  }
  // A CA of the test's own stands in for Let's Encrypt.
  const issuer = caddyCa();
  const server = serverCert(issuer, [HOST]);
  await plant(CADDY_DATA, `${CADDY_LETS_ENCRYPT}/${HOST}.crt`, server.cert);
  await plant(CADDY_DATA, `${CADDY_LETS_ENCRYPT}/${HOST}.key`, server.key);
  await plant(
    CADDY_DATA,
    `${CADDY_LETS_ENCRYPT}/${HOST}.json`,
    JSON.stringify({
      sans: [HOST],
      issuer_data: {
        url: 'https://acme-v02.api.letsencrypt.org/acme/cert/test',
        ca: 'https://acme-v02.api.letsencrypt.org/directory',
      },
    }),
  );
  const digest = await volumeDigest(CADDY_DATA);

  if (!(await upgrade())) return;
  const served = await serves(issuer.cert, '/health', healthy);
  if (served.ok) {
    r.pass(`The Traefik edge serves ${HOST} with the Caddy certificate`);
  } else {
    r.fail(
      `The Traefik edge serves ${HOST} with the Caddy certificate: ${served.last}`,
    );
  }
  // A resolver acts on its domains as soon as it has them; give a late
  // error the time to show.
  await sleep(5_000);

  const mode = (
    await capture([
      'docker',
      'exec',
      'tale-proxy',
      'stat',
      '-c',
      '%a',
      '/data/acme.json',
    ])
  ).stdout.trim();
  let storage: unknown = null;
  try {
    storage = JSON.parse(await proxyFile('/data/acme.json'));
  } catch (error) {
    console.warn(`acme.json cannot be parsed: ${String(error)}`);
  }
  const resolver = isRecord(storage) ? storage.letsencrypt : undefined;
  const stored =
    isRecord(resolver) && Array.isArray(resolver.Certificates)
      ? resolver.Certificates
      : [];
  const domains = stored.map((entry: unknown) =>
    isRecord(entry) && isRecord(entry.domain) ? entry.domain.main : undefined,
  );
  if (
    mode === '600' &&
    isRecord(resolver) &&
    resolver.Account === null &&
    domains.length === 1 &&
    domains[0] === HOST
  ) {
    r.pass('acme.json holds the certificate and no account (mode 600)');
  } else {
    console.log(
      `  acme.json (mode ${mode}): account ${JSON.stringify(isRecord(resolver) ? resolver.Account : undefined)}, domains ${JSON.stringify(domains)}`,
    );
    r.fail('acme.json holds the certificate and no account (mode 600)');
  }

  const logs = await proxyLogs();
  if (
    logs.includes(
      `TLS: took over the certificate of the Caddy proxy for ${HOST}`,
    )
  ) {
    r.pass('The Traefik edge says it took over the certificate');
  } else {
    r.fail('The Traefik edge says it took over the certificate');
  }
  const activity = ACME_ACTIVITY.filter((line) => logs.includes(line));
  if (activity.length === 0) {
    r.pass('The Traefik edge orders nothing');
  } else {
    r.fail(`The Traefik edge orders nothing: ${activity.join('; ')}`);
  }
  await checkUntouched(digest);
}

async function cleanup(failing: boolean): Promise<void> {
  if (process.env.KEEP_RUNNING === 'true') {
    console.log(`${YELLOW}KEEP_RUNNING=true — skipping teardown${NC}`);
    console.log(`The compose files are in ${dir}`);
    return;
  }
  if (failing) {
    header('Proxy logs on failure (last 200 lines)');
    const logs = await capture(['docker', 'logs', '--tail=200', 'tale-proxy']);
    console.log(logs.combined);
  }
  header('Tearing down the upgrade test');
  await traefikEdge.down();
  await caddyEdge.down();
  await removeNetwork(SANDBOX_NET);
  rmSync(dir, { recursive: true, force: true });
}

async function main(): Promise<number> {
  writeSite('selfsigned');
  await traefikEdge.down();
  await caddyEdge.down();
  // Declared `external:` in compose.yml, as the smoke test makes it.
  await recreateNetwork(SANDBOX_NET, [
    '--internal',
    '--ipv6=false',
    '--driver=bridge',
  ]);

  await selfSigned();
  await traefikEdge.down();
  await caddyEdge.down();
  await letsEncrypt();
  return r.failed === 0 && r.passed > 0 ? 0 : 1;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (err) {
  console.error(err);
  exitCode = 1;
}

r.printSummary({
  title: 'PROXY UPGRADE TEST RESULTS',
  nameWidth: 60,
  statusWord: true,
  successBanner: '🎉 THE CADDY EDGE UPGRADES TO THE TRAEFIK EDGE',
});

await cleanup(exitCode !== 0);
process.exit(exitCode);
