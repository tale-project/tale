import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { normalizeCatalogPayload } from '../../../../../services/platform/lib/shared/providers/catalog_normalize';
import { inferenceBundleHash } from './bundle';
import {
  modelIdentity,
  OMLX_RUNTIME,
  parseInferenceSpec,
  type InferenceSpec,
} from './model';
import {
  admittedProofs,
  inferenceCaddyfile,
  inferenceRouterCompose,
  type InferenceReadyProof,
} from './router';
import { inferenceFixture, admissionFixture } from './tests/fixture';

function proofs(spec: InferenceSpec): InferenceReadyProof[] {
  return spec.nodes.map((node) => ({
    ready: true,
    unchanged: true,
    bundleSha256: inferenceBundleHash(spec),
    release: 'b'.repeat(64),
    organization: spec.organization,
    node: node.key,
    address: node.address,
    port: node.port,
    runtimeVersion: OMLX_RUNTIME.version,
    runtimeSha256: OMLX_RUNTIME.sha256,
    models: spec.models
      .filter((model) => node.models.includes(model.key))
      .map((model) => ({
        key: model.key,
        apiModel: model.apiModel,
        identity: modelIdentity(model),
        capability: model.capability,
        configurationProjection: model.configurationProjection ?? null,
      })),
    observedAt: new Date().toISOString(),
    performanceMeasured: true,
    capabilitiesVerified: true,
    boundedBenchmarkVerified: true,
    sustainedLoadMeasured: false,
    admission: {
      adapterSha256: admissionFixture(spec, node).adapterSha256,
      policySha256: admissionFixture(spec, node).policySha256,
      residency: 'evictable-on-demand',
      maximumConcurrency: 1,
      loadedRoles: node.models,
    },
  }));
}
describe('inference router custody', () => {
  test('keeps inactive models at explicit503 and confines the router to its private namespace', () => {
    const spec = parseInferenceSpec(inferenceFixture());
    const file = inferenceCaddyfile(spec, []);
    expect(file).toContain('no admitted ready replica');
    expect(file).not.toContain('reverse_proxy');
    const compose = inferenceRouterCompose(spec, {
      schemaVersion: 1,
      backendNetwork: 'tale_default',
      overlayNetwork: { env: 'TALE_INFERENCE_NETWORK_ID' },
    });
    expect(compose.services['inference-router'].network_mode).toBe(
      'service:inference-overlay',
    );
    expect(JSON.stringify(compose)).not.toContain('ports');
    expect(JSON.stringify(compose)).not.toContain('privileged');
    expect(
      compose.services['inference-overlay'].networks['inference-backend']
        .aliases,
    ).toEqual(['inference-overlay.local']);
  });
  test.each([
    'stale',
    'future',
    'organization',
    'model',
    'address',
    'bundle',
    'duplicate',
  ])('refuses a %s readiness proof', (kind) => {
    const spec = parseInferenceSpec(inferenceFixture());
    const values = proofs(spec);
    const first = values[0]!;
    if (kind === 'stale')
      first.observedAt = new Date(Date.now() - 600001).toISOString();
    if (kind === 'future')
      first.observedAt = new Date(Date.now() + 120000).toISOString();
    if (kind === 'organization') first.organization = 'different-client';
    if (kind === 'model') first.models[0]!.identity = 'c'.repeat(64);
    if (kind === 'address') first.address = '10.70.0.11';
    if (kind === 'bundle') first.bundleSha256 = 'd'.repeat(64);
    if (kind === 'duplicate') values.push(first);
    expect(() => admittedProofs(spec, values)).toThrow();
  });
});

const caddy = process.env.TALE_TEST_CADDY ?? Bun.which('caddy');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function proxyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-inference-caddy-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const requests = [0, 0];
  const checks = [0, 0];
  const held: ReadableStreamDefaultController<Uint8Array>[] = [];
  const key = 's'.repeat(32);
  const servers = [0, 1].map((index) =>
    Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        if (request.headers.get('authorization') !== `Bearer ${key}`)
          return new Response(null, { status: 401 });
        if (new URL(request.url).pathname === '/_tale/admission') {
          checks[index]++;
          return Response.json(admissionFixture(spec, spec.nodes[index]!));
        }
        requests[index]++;
        expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
        const input = z
          .object({ mode: z.string().optional() })
          .parse(await request.json());
        if (input.mode === 'fail')
          return Response.json(
            { error: 'synthetic unavailable' },
            { status: 503 },
          );
        if (input.mode === 'hold')
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(`data: node-${index}\n\n`),
                );
                held.push(controller);
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        if (input.mode === 'sse')
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('data: {"text":"Grüezi"}\n\n'),
                );
                await Bun.sleep(50);
                controller.enqueue(
                  new TextEncoder().encode('data: [DONE]\n\n'),
                );
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        return Response.json({ node: index });
      },
    }),
  );
  cleanups.push(async () => {
    for (const controller of held) {
      try {
        controller.close();
      } catch {
        /* Already cancelled by the owned client. */
      }
    }
    for (const server of servers) await server.stop(true);
  });
  const raw = inferenceFixture();
  raw.nodes = servers.map((server, index) =>
    Object.assign({}, raw.nodes[0], {
      key: `studio-${index}`,
      address: '127.0.0.1',
      port: server.port!,
      adminKey: { env: `TALE_INFERENCE_ADMIN_${index}` },
    }),
  );
  const spec = parseInferenceSpec({
    ...raw,
    limits: { concurrency: 1, queuedRequests: 0 },
  });
  const portProbe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const port = portProbe.port!;
  await portProbe.stop(true);
  const config = join(root, 'Caddyfile');
  await writeFile(config, inferenceCaddyfile(spec, proofs(spec), port));
  const child = Bun.spawn(
    [caddy!, 'run', '--config', config, '--adapter', 'caddyfile'],
    {
      env: { ...process.env, [spec.serviceKey.env]: key },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  cleanups.push(async () => {
    child.kill();
    await child.exited;
    await stdout;
    await stderr;
  });
  const url = `http://127.0.0.1:${port}/${spec.organization}/reasoning/v1/chat/completions`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url);
      await response.body?.cancel();
      if (response.status === 401 && checks.every((value) => value > 0)) {
        ready = true;
        break;
      }
    } catch {
      /* Starting the owned proxy. */
    }
    await Bun.sleep(50);
  }
  if (!ready) {
    child.kill();
    throw new Error(
      'Pinned synthetic Caddy failed to start: ' +
        (await stderr).slice(0, 4000),
    );
  }
  const send = (mode?: string, affinity?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...(affinity ? { 'X-Tale-Cache-Affinity': affinity } : {}),
      },
      body: JSON.stringify({ model: 'Example-Model', mode }),
    });
  return { requests, checks, held, send, url, key };
}

describe.skipIf(!caddy)(
  'real Caddy, synthetic HTTP replicas (no model execution)',
  () => {
    test('preserves SSE chunks, denies unknown routes and uses stable affinity', async () => {
      const f = await proxyFixture();
      expect((await fetch(f.url)).status).toBe(401);
      const first = await (await f.send(undefined, 'synthetic-thread')).json();
      const second = await (await f.send(undefined, 'synthetic-thread')).json();
      expect(second).toEqual(first);
      const stream = await f.send('sse');
      const reader = stream.body!.getReader();
      const initial = await reader.read();
      expect(new TextDecoder().decode(initial.value)).toContain('Grüezi');
      let rest = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += new TextDecoder().decode(chunk.value);
      }
      expect(rest).toContain('[DONE]');
      expect(
        (
          await fetch(
            f.url.replace('/v1/chat/completions', '/admin/settings'),
            { headers: { authorization: `Bearer ${f.key}` } },
          )
        ).status,
      ).toBe(404);
    }, 30000);
    test('serves exact non-secret catalog metadata internally without authorizing an inference request', async () => {
      const f = await proxyFixture();
      const catalogUrl = f.url.replace('/chat/completions', '/models');
      const response = await fetch(catalogUrl);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      );
      const catalog = normalizeCatalogPayload(
        await response.json(),
        'omlx-reasoning',
      );
      expect(catalog.droppedCount).toBe(0);
      expect(catalog.entries).toEqual([
        {
          id: 'Example-Model',
          provider: 'omlx-reasoning',
          tags: ['chat'],
          supportsTools: true,
          supportsVision: false,
          contextWindow: 16384,
        },
      ]);
      expect((await fetch(f.url, { method: 'POST', body: '{}' })).status).toBe(
        401,
      );
      expect(
        (
          await fetch(
            catalogUrl.replace('/synthetic-client/', '/other-client/'),
          )
        ).status,
      ).toBe(401);
      expect(f.requests).toEqual([0, 0]);
    }, 30000);
    test('rejects an overloaded pool before sending a third request and never retries a failed POST', async () => {
      const f = await proxyFixture();
      const first = await f.send('hold');
      const second = await f.send('hold');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const busy = await f.send();
      expect(busy.status).toBe(503);
      expect(busy.headers.get('retry-after')).toBe('10');
      expect(f.requests).toEqual([1, 1]);
      for (const controller of f.held.splice(0)) controller.close();
      await first.text();
      await second.text();
      await Bun.sleep(50);
      const failed = await f.send('fail');
      expect(failed.status).toBe(503);
      expect(f.requests.reduce((a, b) => a + b, 0)).toBe(3);
      const next = await f.send();
      expect(next.status).toBe(200);
      expect(f.requests.reduce((a, b) => a + b, 0)).toBe(4);
    }, 30000);
  },
);
