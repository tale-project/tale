import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256 } from '../config/releases/identity';
import { prepareInference, prepareInferenceValue } from './bundle';
import { privateDirectory } from './files';
import {
  applyInference,
  rollbackInference,
  statusInference,
  type InferenceOperations,
} from './lifecycle';
import { GIB, modelIdentity, OMLX_RUNTIME, type InferenceModel } from './model';
import { verifyModel } from './models';
import {
  inferenceFixture,
  admissionFixture,
  admissionHeaders,
} from './tests/fixture';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-inference-lifecycle-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const state = join(root, 'state');
  const bytes = new Map([
    ['config.json', Buffer.from('{"model_type":"glm_moe_dsa"}')],
    ['model.safetensors', Buffer.from('synthetic shard, no GPU model')],
  ]);
  let active: string | undefined;
  let activations = 0;
  let failAfterActivation = false;
  let busy = false;
  let embeddingBusy = false;
  let logouts = 0;
  let unavailable = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (!active || unavailable) return new Response(null, { status: 503 });
      const directory = join(state, 'releases', active);
      const settings = JSON.parse(
        await readFile(join(directory, 'settings.json'), 'utf8'),
      );
      const record = JSON.parse(
        await readFile(join(directory, 'release.json'), 'utf8'),
      );
      const path = new URL(request.url).pathname;
      if (path === '/health') return Response.json({ status: 'healthy' });
      if (path === '/admin/api/login') {
        const body = z
          .object({ api_key: z.string(), remember: z.boolean() })
          .parse(await request.json());
        if (body.api_key !== settings.auth.api_key || body.remember !== false)
          return new Response(null, { status: 401 });
        return Response.json(
          { success: true },
          {
            headers: {
              'set-cookie':
                'omlx_admin_session=synthetic.session; Path=/; HttpOnly',
            },
          },
        );
      }
      if (path.startsWith('/admin/api/')) {
        if (
          request.headers.get('cookie') !==
          'omlx_admin_session=synthetic.session'
        )
          return new Response(null, { status: 401 });
        if (path.endsWith('/logout')) {
          logouts++;
          return Response.json({ success: true });
        }
        if (path.endsWith('/activity'))
          return Response.json({
            active_models: {
              total_active_requests: busy || embeddingBusy ? 1 : 0,
              total_waiting_requests: 0,
            },
          });
      }
      if (
        request.headers.get('authorization') !==
        `Bearer ${settings.auth.sub_keys[0].key}`
      )
        return new Response(null, { status: 401 });
      if (path === '/v1/chat/completions' && request.method === 'POST') {
        const body = z
          .object({ tools: z.unknown().optional() })
          .parse(await request.json());
        const tool = body.tools !== undefined;
        return new Response(
          'data: ' +
            JSON.stringify({
              model: record.spec.models[0].apiModel,
              choices: [
                {
                  index: 0,
                  delta: tool
                    ? {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'inert-probe',
                            type: 'function',
                            function: {
                              name: 'tale_capability_probe',
                              arguments: '{"marker":"ready"}',
                            },
                          },
                        ],
                      }
                    : { content: 'READY' },
                  finish_reason: null,
                },
              ],
            }) +
            '\n\n' +
            'data: ' +
            JSON.stringify({
              model: record.spec.models[0].apiModel,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: tool ? 'tool_calls' : 'stop',
                },
              ],
              usage: { prompt_tokens: 7, completion_tokens: 1 },
            }) +
            '\n\ndata: [DONE]\n\n',
          {
            headers: {
              'content-type': 'text/event-stream',
              ...admissionHeaders,
            },
          },
        );
      }
      if (path === '/_tale/admission')
        return Response.json(
          admissionFixture(record.spec, record.spec.nodes[0]!),
        );
      if (path === '/api/status')
        return Response.json({
          status: 'ok',
          version: OMLX_RUNTIME.version,
          loaded_models: record.spec.models.map(modelIdentity),
          models_discovered: 1,
          models_loaded: 1,
          models_loading: 0,
          custom_kernels: { glm_moe_dsa: { available: true } },
          active_requests: busy ? 1 : 0,
          waiting_requests: 0,
        });
      return Response.json({
        data: record.spec.models.map((model: InferenceModel) => ({
          id: model.apiModel,
          max_model_len: model.contextTokens,
        })),
      });
    },
  });
  cleanups.push(async () => {
    await server.stop(true);
  });
  const raw = inferenceFixture();
  raw.models[0]!.files = [...bytes].map(([path, contents]) => ({
    path,
    bytes: contents.length,
    sha256: sha256(contents),
  }));
  raw.nodes[0]!.address = '127.0.0.1';
  const makeBundle = async (context: number, committed = false) => {
    const input = {
      ...raw,
      models: [{ ...raw.models[0], contextTokens: context }],
      nodes: [{ ...raw.nodes[0], port: server.port }],
    };
    const spec = join(root, `spec-${context}.json`);
    await writeFile(spec, JSON.stringify(input));
    const output = join(root, `bundle-${context}`);
    const content = JSON.stringify(input);
    const bundle = committed
      ? await prepareInferenceValue(
          input,
          output,
          {},
          {
            repository: 'https://github.com/example/client',
            revision: 'a'.repeat(40),
            specPath: 'tale/inference/spec.json',
            content,
            sha256: sha256(content),
          },
        )
      : await prepareInference(spec, output);
    return {
      bundle: output,
      bundleSha256: bundle.bundleSha256,
      node: 'studio-one',
    };
  };
  const operations: Partial<InferenceOperations> = {
    assertTarget: () => {
      /* All execution is model-free, isolated fake target IO. */
    },
    hardware: async () => ({
      platform: 'darwin',
      architecture: 'arm64',
      macOSMajor: 15,
      user: 'inference',
      home: '/Users/inference',
      hostName: 'studio-one',
      uid: process.getuid!(),
      administrator: false,
      launchdUserDomain: true,
      addresses: ['127.0.0.1'],
      memoryBytes: 64 * GIB,
      freeDiskBytes: 512 * GIB,
    }),
    stateDirectory: () => state,
    serviceCustody: async () => undefined,
    directory: (directory, _home, uid) =>
      privateDirectory(directory, root, uid),
    runtime: async () => {
      const app = join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app');
      await mkdir(app, { recursive: true });
      return app;
    },
    verifyRuntime: async () => undefined,
    memory: async () => ({ pressure: 1, swapUsedBytes: 0, swapOutPages: 0 }),
    probe: async () => ({
      availableKernels: ['glm_moe_dsa'],
      metalWorkingSetBytes: 60 * GIB,
    }),
    model: async (_state, model) => {
      const directory = join(state, 'models', modelIdentity(model));
      await mkdir(directory, { recursive: true });
      for (const file of model.files) {
        const target = join(directory, file.path);
        try {
          await writeFile(target, bytes.get(file.path)!, { flag: 'wx' });
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              error.code === 'EEXIST'
            )
          )
            throw error;
        }
      }
      await verifyModel(state, model);
    },
    activate: async (_node, _uid, plist) => {
      activations++;
      active = basename(dirname(plist));
      if (failAfterActivation) throw new Error('synthetic response loss');
    },
    running: async (_node, _uid, _state, release) => active === release,
    wait: async () => undefined,
  };
  const environment = {
    TALE_INFERENCE_STUDIO_ADMIN_KEY: 'a'.repeat(32),
    TALE_SECRETS_INFERENCE_API_KEY: 's'.repeat(32),
  };
  return {
    root,
    state,
    makeBundle,
    operations,
    environment,
    activations: () => activations,
    loseActivationResponse: () => {
      failAfterActivation = true;
    },
    allowResponse: () => {
      failAfterActivation = false;
    },
    setBusy: () => {
      busy = true;
    },
    setEmbeddingBusy: () => {
      embeddingBusy = true;
    },
    logouts: () => logouts,
    resetBusy: () => {
      busy = false;
    },
    setUnavailable: () => {
      unavailable = true;
    },
  };
}

describe.skipIf(
  process.platform === 'win32' || !process.getuid || process.getuid() < 501,
)('model-free inference lifecycle with real files and HTTP', () => {
  test('refuses an unrecorded service before acquisition and rechecks custody before activation', async () => {
    const f = await fixture();
    const bundle = await f.makeBundle(8192);
    let runtimeCalls = 0;
    const runtime = f.operations.runtime!;
    f.operations.runtime = async (...args) => {
      runtimeCalls++;
      return runtime(...args);
    };
    f.operations.serviceCustody = async () => {
      throw new Error('Unrecorded inference service');
    };
    await expect(
      applyInference(bundle, f.operations, f.environment),
    ).rejects.toThrow('Unrecorded inference service');
    expect(runtimeCalls).toBe(0);
    expect(f.activations()).toBe(0);
    let inspections = 0;
    f.operations.serviceCustody = async () => {
      if (++inspections === 2) throw new Error('Changed inference service');
    };
    await expect(
      applyInference(bundle, f.operations, f.environment),
    ).rejects.toThrow('Changed inference service');
    expect(runtimeCalls).toBe(1);
    expect(f.activations()).toBe(0);
  });
  test('retains committed source provenance through activation and exact ready replay', async () => {
    const f = await fixture();
    const bundle = await f.makeBundle(8192, true);
    const first = await applyInference(bundle, f.operations, f.environment);
    expect((await statusInference(bundle, f.operations)).ready).toBe(true);
    expect(
      (await applyInference(bundle, f.operations, f.environment)).release,
    ).toBe(first.release);
    expect(
      JSON.parse(
        await readFile(
          join(f.state, 'releases', first.release, 'release.json'),
          'utf8',
        ),
      ).source.revision,
    ).toBe('a'.repeat(40));
    expect(f.activations()).toBe(1);
  });
  test('rechecks a lowered effective Metal cap after staging and during ready status', async () => {
    const f = await fixture();
    const bundle = await f.makeBundle(8192);
    const originalHardware = f.operations.hardware!;
    const originalModel = f.operations.model!;
    let staged = false;
    f.operations.hardware = async (...args) => ({
      ...(await originalHardware(...args)),
      ...(staged ? { metalWiredLimitBytes: 1 } : {}),
    });
    f.operations.model = async (...args) => {
      await originalModel(...args);
      staged = true;
    };
    await expect(
      applyInference(bundle, f.operations, f.environment),
    ).rejects.toThrow('Metal effective');
    expect(f.activations()).toBe(0);
    f.operations.hardware = originalHardware;
    await applyInference(bundle, f.operations, f.environment);
    f.operations.hardware = async (...args) => ({
      ...(await originalHardware(...args)),
      metalWiredLimitBytes: 1,
    });
    await expect(statusInference(bundle, f.operations)).rejects.toThrow(
      'Metal effective',
    );
  });
  test.each(['adapter-bytes', 'adapter-mode', 'policy-extra'] as const)(
    'holds exact admission custody drift: %s',
    async (kind) => {
      const f = await fixture();
      const bundle = await f.makeBundle(8192);
      const first = await applyInference(bundle, f.operations, f.environment);
      const directory = join(f.state, 'releases', first.release);
      const adapter = join(directory, 'runtime-admission.py');
      if (kind === 'adapter-bytes') await writeFile(adapter, 'changed');
      if (kind === 'adapter-mode') await chmod(adapter, 0o644);
      if (kind === 'policy-extra') {
        const file = join(directory, 'admission.json');
        const policy = JSON.parse(await readFile(file, 'utf8'));
        await writeFile(file, JSON.stringify({ ...policy, unbound: true }));
      }
      await expect(statusInference(bundle, f.operations)).rejects.toThrow();
      await expect(
        applyInference(bundle, f.operations, f.environment),
      ).rejects.toThrow();
      expect(f.activations()).toBe(1);
    },
    30000,
  );
  test('activates once, verifies exact replay and retains the old ready release for rollback', async () => {
    const f = await fixture();
    const first = await f.makeBundle(8192);
    const original = await applyInference(first, f.operations, f.environment);
    expect(original.ready).toBe(true);
    expect(f.activations()).toBe(1);
    expect(
      (await applyInference(first, f.operations, f.environment)).unchanged,
    ).toBe(true);
    expect(f.activations()).toBe(1);
    expect((await statusInference(first, f.operations)).ready).toBe(true);
    const second = await f.makeBundle(16384);
    const changed = await applyInference(second, f.operations, f.environment);
    expect(changed.release).not.toBe(original.release);
    expect(f.activations()).toBe(2);
    const restored = await rollbackInference(
      { ...first, release: original.release },
      f.operations,
    );
    expect(restored.ready).toBe(true);
    expect(f.activations()).toBe(3);
    const output = JSON.stringify(restored);
    expect(output).not.toContain(f.environment.TALE_SECRETS_INFERENCE_API_KEY);
    expect(
      JSON.parse(await readFile(join(f.state, 'current.json'), 'utf8')).phase,
    ).toBe('ready');
  }, 30000);
  test('reconciles accepted activation with a lost response without a second bootstrap', async () => {
    const f = await fixture();
    const options = await f.makeBundle(8192);
    f.loseActivationResponse();
    await expect(
      applyInference(options, f.operations, f.environment),
    ).rejects.toThrow('synthetic response loss');
    expect(
      JSON.parse(await readFile(join(f.state, 'current.json'), 'utf8')).phase,
    ).toBe('pending');
    f.allowResponse();
    const resumed = await applyInference(options, f.operations, f.environment);
    expect(resumed.ready).toBe(true);
    expect(f.activations()).toBe(1);
  }, 30000);
  test('does not activate a second release while requests are active', async () => {
    const f = await fixture();
    const first = await f.makeBundle(8192);
    const initial = await applyInference(first, f.operations, f.environment);
    f.setBusy();
    const next = await f.makeBundle(16384);
    await expect(
      applyInference(next, f.operations, f.environment),
    ).rejects.toThrow('active or queued');
    expect(f.activations()).toBe(1);
    expect(
      JSON.parse(await readFile(join(f.state, 'current.json'), 'utf8')).release,
    ).toBe(initial.release);
  }, 30000);
  test('never repairs a drifted setting or model blob by overwriting it', async () => {
    const f = await fixture();
    const options = await f.makeBundle(8192);
    const initial = await applyInference(options, f.operations, f.environment);
    const file = join(f.state, 'releases', initial.release, 'settings.json');
    const settings = JSON.parse(await readFile(file, 'utf8'));
    settings.auth.skip_api_key_verification = true;
    await writeFile(file, JSON.stringify(settings));
    await expect(
      applyInference(options, f.operations, f.environment),
    ).rejects.toThrow('settings differ');
    expect(f.activations()).toBe(1);
    expect(
      JSON.parse(await readFile(file, 'utf8')).auth.skip_api_key_verification,
    ).toBe(true);
  }, 30000);
  test('holds active embeddings even when public status reports zero and closes the admin session', async () => {
    const f = await fixture();
    const first = await f.makeBundle(8192);
    const initial = await applyInference(first, f.operations, f.environment);
    f.setEmbeddingBusy();
    const next = await f.makeBundle(16384);
    await expect(
      applyInference(next, f.operations, f.environment),
    ).rejects.toThrow('active or queued');
    expect(f.activations()).toBe(1);
    expect(f.logouts()).toBe(1);
    expect(
      JSON.parse(await readFile(join(f.state, 'current.json'), 'utf8')).release,
    ).toBe(initial.release);
  }, 30000);
  test('refuses an unqualified target before runtime, model or service mutations', async () => {
    const f = await fixture();
    const options = await f.makeBundle(8192);
    let installed = false;
    await expect(
      applyInference(
        options,
        {
          ...f.operations,
          hardware: async () => ({
            ...(await f.operations.hardware!()),
            administrator: true,
          }),
          runtime: async () => {
            installed = true;
            throw preconditionError('not reached');
          },
        },
        f.environment,
      ),
    ).rejects.toThrow('standard macOS user');
    expect(installed).toBe(false);
    expect(f.activations()).toBe(0);
  }, 30000);
  test('rejects another organization before staging any of its files', async () => {
    const f = await fixture();
    const first = await f.makeBundle(8192);
    await applyInference(first, f.operations, f.environment);
    const currentFile = join(f.state, 'current.json');
    const current = JSON.parse(await readFile(currentFile, 'utf8'));
    await writeFile(
      currentFile,
      JSON.stringify({ ...current, organization: 'another-org' }),
    );
    const releases = await readdir(join(f.state, 'releases'));
    let installs = 0;
    await expect(
      applyInference(
        await f.makeBundle(16384),
        {
          ...f.operations,
          runtime: async () => {
            installs++;
            throw new Error('must not reach runtime');
          },
        },
        f.environment,
      ),
    ).rejects.toThrow('different node or organization');
    expect(installs).toBe(0);
    expect(await readdir(join(f.state, 'releases'))).toEqual(releases);
  }, 30000);
  test('does not interrupt requests accepted by a pending activation during rollback', async () => {
    const f = await fixture();
    const first = await f.makeBundle(8192);
    const ready = await applyInference(first, f.operations, f.environment);
    const next = await f.makeBundle(16384);
    f.loseActivationResponse();
    await expect(
      applyInference(next, f.operations, f.environment),
    ).rejects.toThrow('synthetic response loss');
    f.allowResponse();
    f.setBusy();
    await expect(
      rollbackInference({ ...first, release: ready.release }, f.operations),
    ).rejects.toThrow('active or queued');
    expect(f.activations()).toBe(2);
    f.resetBusy();
    expect(
      (
        await rollbackInference(
          { ...first, release: ready.release },
          f.operations,
        )
      ).ready,
    ).toBe(true);
  }, 30000);
  test('refuses status on another host before trusting the retained ready receipt', async () => {
    const f = await fixture();
    const options = await f.makeBundle(8192);
    await applyInference(options, f.operations, f.environment);
    await expect(
      statusInference(options, {
        ...f.operations,
        hardware: async () => ({
          ...(await f.operations.hardware!()),
          hostName: 'wrong-host',
        }),
      }),
    ).rejects.toThrow('standard macOS user and host');
  }, 30000);
});
