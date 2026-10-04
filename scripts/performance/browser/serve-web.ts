import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { json, outputPath, sources } from './common.ts';
import { backendOrigin, browserOrigins, webHost } from './origins.mjs';
import { diagnosticWebFetch } from './web-routing.ts';

const variant = process.argv[2];
assert(variant === 'baseline' || variant === 'candidate', 'Unknown source arm');
assert.equal(process.platform, 'linux', 'Measured web wrapper requires Linux');
assert.equal(process.arch, 'x64', 'Measured web wrapper requires Linux x64');
const source = await sources();
assert.equal(Bun.version, source.bun, 'Web Bun differs from the root pin');
assert.equal(process.env.NODE_ENV, 'production');
const runtime = z
  .object({
    version: z.string(),
    path: z.string().startsWith('/'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .parse(JSON.parse(await readFile(outputPath('bun-runtime.json'), 'utf8')));
assert.equal(runtime.version, source.bun);
const executableSha256 = createHash('sha256')
  .update(await readFile(process.execPath))
  .digest('hex');
assert.equal(
  executableSha256,
  runtime.sha256,
  'Mounted Bun bytes differ from host proof',
);
const root =
  variant === 'baseline' ? source.baselinePath : source.candidatePath;
const modulePath = join(root, 'services/platform/server.ts');
const { createApp } = await import(pathToFileURL(modulePath).href);
const origin = browserOrigins[variant === 'baseline' ? 0 : 1]!;
assert.equal(
  process.env.SITE_URL,
  origin,
  'Web origin differs from the source arm',
);
assert(
  process.env.BENCH_TLS_KEY && process.env.BENCH_TLS_CERT,
  'Owned TLS material is missing',
);
const server = Bun.serve({
  hostname: webHost,
  port: Number(new URL(origin).port),
  idleTimeout: 255,
  tls: {
    key: process.env.BENCH_TLS_KEY!,
    cert: Bun.file(process.env.BENCH_TLS_CERT!),
  },
  fetch: diagnosticWebFetch(createApp(), backendOrigin),
});
await json(`web-${variant}-runtime.json`, {
  source: source[variant],
  modulePath,
  moduleSha256: createHash('sha256')
    .update(await readFile(modulePath))
    .digest('hex'),
  bun: Bun.version,
  platform: process.platform,
  arch: process.arch,
  executableSha256,
  hostname: server.hostname,
  port: server.port,
});
