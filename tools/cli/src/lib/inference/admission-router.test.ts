import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { admissionPolicy, INFERENCE_ADMISSION_SOURCE } from './admission';
import { inferenceBundleHash } from './bundle';
import { inferenceAdmissionSchema } from './http';
import { modelIdentity, OMLX_RUNTIME, parseInferenceSpec } from './model';
import { inferenceCaddyfile, type InferenceReadyProof } from './router';
import { inferenceFixture } from './tests/fixture';

const caddy = process.env.TALE_TEST_CADDY ?? Bun.which('caddy');
const python =
  process.env.TALE_TEST_PYTHON ?? Bun.which('python3') ?? Bun.which('python');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(queuedRequests = 2) {
  const root = await mkdtemp(join(tmpdir(), 'tale-native-gate-router-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const adapter = join(root, 'runtime-admission.py');
  const driver = join(root, 'driver.py');
  const listener = join(root, 'listener.json');
  const policyFile = join(root, 'policy.json');
  await writeFile(adapter, INFERENCE_ADMISSION_SOURCE);
  await writeFile(
    driver,
    await readFile(new URL('./tests/admission_fixture.py', import.meta.url)),
  );
  const raw = inferenceFixture();
  const spec = parseInferenceSpec({
    ...raw,
    models: ['reasoning', 'vision', 'embedding'].map((role) =>
      Object.assign({}, raw.models[0], {
        key: role,
        apiModel: role,
        capability: role === 'reasoning' ? 'text' : role,
        ...(role === 'embedding' ? { embeddingDimensions: 1536 } : {}),
        requiredKernels: [],
        modelType: role === 'vision' ? 'qwen3_vl' : 'qwen3',
      }),
    ),
    nodes: [
      {
        ...raw.nodes[0],
        address: '127.0.0.1',
        models: ['reasoning', 'vision', 'embedding'],
      },
    ],
    limits: { queuedRequests },
  });
  await writeFile(
    policyFile,
    JSON.stringify(admissionPolicy(spec, spec.nodes[0]!)),
  );
  const native = Bun.spawn(
    [python!, driver, adapter, '--serve', policyFile, listener],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const nativeOut = new Response(native.stdout).text();
  const nativeErr = new Response(native.stderr).text();
  cleanups.push(async () => {
    native.kill();
    await native.exited;
    await nativeOut;
    await nativeErr;
  });
  let upstreamPort = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      upstreamPort = JSON.parse(await readFile(listener, 'utf8')).port;
      break;
    } catch {
      await Bun.sleep(20);
    }
  }
  expect(upstreamPort).toBeGreaterThan(0);
  spec.nodes[0]!.port = upstreamPort;
  // Listener addresses do not enter the native policy; only exact node/model
  // custody and resource admission do. This is the actual packaged middleware.
  const node = spec.nodes[0]!;
  const policy = admissionPolicy(spec, node);
  const proof: InferenceReadyProof = {
    ready: true,
    unchanged: true,
    bundleSha256: inferenceBundleHash(spec),
    release: 'a'.repeat(64),
    organization: spec.organization,
    node: node.key,
    address: node.address,
    port: node.port,
    runtimeVersion: OMLX_RUNTIME.version,
    runtimeSha256: OMLX_RUNTIME.sha256,
    models: spec.models.map((model) => ({
      key: model.key,
      apiModel: model.apiModel,
      identity: modelIdentity(model),
      capability: model.capability,
      configurationProjection: null,
    })),
    observedAt: new Date().toISOString(),
    performanceMeasured: true,
    capabilitiesVerified: true,
    boundedBenchmarkVerified: true,
    sustainedLoadMeasured: false,
    admission: {
      adapterSha256: policy.adapterSha256,
      policySha256: policy.policySha256,
      residency: 'evictable-on-demand',
      maximumConcurrency: 1,
      loadedRoles: [],
    },
  };
  const probe = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port!;
  await probe.stop(true);
  const config = join(root, 'Caddyfile');
  await writeFile(config, inferenceCaddyfile(spec, [proof], port));
  const proxy = Bun.spawn(
    [caddy!, 'run', '--config', config, '--adapter', 'caddyfile'],
    {
      env: { ...process.env, [spec.serviceKey.env]: 's'.repeat(32) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const proxyOut = new Response(proxy.stdout).text();
  const proxyErr = new Response(proxy.stderr).text();
  cleanups.push(async () => {
    proxy.kill();
    await proxy.exited;
    await proxyOut;
    await proxyErr;
  });
  const headers = {
    authorization: `Bearer ${'s'.repeat(32)}`,
    'content-type': 'application/json',
  };
  const base = `http://127.0.0.1:${port}/${spec.organization}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const r = await fetch(`${base}/reasoning/v1/models`);
      await r.body?.cancel();
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Owned process startup. */
    }
    await Bun.sleep(20);
  }
  expect(ready).toBe(true);
  const observe = async () =>
    z
      .object({
        entered: z.array(z.string()),
        peak: z.number(),
        active: z.number(),
      })
      .parse(
        await (
          await fetch(`http://127.0.0.1:${upstreamPort}/api/status`, {
            headers,
          })
        ).json(),
      );
  const gate = async () =>
    inferenceAdmissionSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${upstreamPort}/_tale/admission`, {
          headers,
        })
      ).json(),
    );
  const waitForGate = async (
    predicate: (value: Awaited<ReturnType<typeof gate>>) => boolean,
  ) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate(await gate())) return;
      await Bun.sleep(10);
    }
    throw new Error('Synthetic admission state was not observed');
  };
  const release = async () => {
    const response = await fetch(
      `http://127.0.0.1:${upstreamPort}/__fixture/release`,
      { method: 'POST' },
    );
    expect(response.status).toBe(204);
    await response.body?.cancel();
  };
  const send = (
    role: string,
    body: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) =>
    fetch(
      `${base}/${role}/v1/${role === 'embedding' ? 'embeddings' : 'chat/completions'}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: role,
          ...(role === 'embedding' ? { input: ['synthetic'] } : {}),
          ...body,
        }),
        signal,
      },
    );
  return { send, observe, gate, waitForGate, release };
}

describe.skipIf(!caddy || !python)(
  'actual pinned Caddy + packaged ASGI gate, synthetic model work',
  () => {
    test('serializes all three role routes with cold models and preserves complete SSE', async () => {
      const f = await fixture();
      const first = await f.send('reasoning', { holdAfterHeaders: true });
      const vision = f.send('vision');
      await f.waitForGate((value) => value.queued === 1);
      const embedding = f.send('embedding', {
        input: Array.from({ length: 64 }, (_, i) => String(i)),
      });
      await f.waitForGate((value) => value.queued === 2);
      await f.release();
      expect(first.headers.get('x-tale-model-cold')).toBe('true');
      expect(await first.text()).toContain('[DONE]');
      expect(await (await vision).text()).toContain('[DONE]');
      const result = z
        .object({ data: z.array(z.object({ index: z.number() })) })
        .parse(await (await embedding).json());
      expect(result.data).toHaveLength(64);
      expect(result.data.map((item: { index: number }) => item.index)).toEqual(
        Array.from({ length: 64 }, (_, i) => i),
      );
      expect(await f.observe()).toEqual({
        entered: ['reasoning', 'vision', 'embedding'],
        peak: 1,
        active: 0,
      });
      const status = await f.gate();
      expect(status.ready).toBe(true);
      expect(
        status.models
          .filter((model: { loaded: boolean }) => model.loaded)
          .map((model: { key: string }) => model.key),
      ).toEqual(['embedding']);
    }, 30000);
    test('retains native work after client disconnect before starting another role', async () => {
      const f = await fixture();
      const abort = new AbortController();
      const first = await f.send(
        'reasoning',
        { holdAfterHeaders: true },
        abort.signal,
      );
      const reader = first.body!.getReader();
      await reader.read();
      abort.abort();
      await reader.cancel().catch(() => {});
      const next = f.send('vision');
      await f.waitForGate((value) => value.queued === 1);
      expect(await f.observe()).toEqual({
        entered: ['reasoning'],
        peak: 1,
        active: 1,
      });
      await f.release();
      expect(await (await next).text()).toContain('[DONE]');
      expect(await f.observe()).toEqual({
        entered: ['reasoning', 'vision'],
        peak: 1,
        active: 0,
      });
    }, 30000);
    test('removes queued cancellations and bounds excess requests without replay', async () => {
      const f = await fixture(1);
      const first = await f.send('reasoning', { holdAfterHeaders: true });
      const abort = new AbortController();
      const cancelled = f
        .send('vision', {}, abort.signal)
        .catch(() => undefined);
      await f.waitForGate((value) => value.queued === 1);
      abort.abort();
      await cancelled;
      await f.waitForGate((value) => value.cancelled > 0 && value.queued === 0);
      const queued = f.send('embedding');
      await f.waitForGate((value) => value.queued === 1);
      const rejected = await f.send('vision');
      expect(rejected.status).toBe(503);
      await rejected.body?.cancel();
      await f.release();
      await first.text();
      await (await queued).text();
      expect(await f.observe()).toEqual({
        entered: ['reasoning', 'embedding'],
        peak: 1,
        active: 0,
      });
      expect((await f.gate()).cancelled).toBeGreaterThan(0);
    }, 30000);
  },
);
