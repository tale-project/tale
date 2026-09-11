import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  CliError,
  externalDepError,
  preconditionError,
} from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { sha, slug } from '../config/releases/model';
import { withLock } from '../state/with-lock';
import {
  admissionPolicy,
  INFERENCE_ADMISSION_FILENAME,
  INFERENCE_ADMISSION_SHA,
  INFERENCE_ADMISSION_SOURCE,
} from './admission';
import { benchmarkCapabilities, capabilityProofSchema } from './benchmark';
import { inferenceBundleHash, verifyInferenceBundle } from './bundle';
import {
  privateDirectory,
  ownedDirectory,
  excludeRegenerableDirectory,
  readOptionalJson,
  readPrivateJson,
  writePrivateJson,
  writePrivateText,
  fileDigest,
} from './files';
import {
  requireIdleInference,
  verifyInferenceApi,
  type InferenceAdmission,
} from './http';
import {
  activateLaunchAgent,
  installOmlxRuntime,
  launchAgentMatches,
  observeMacHardware,
  persistedPlistMatches,
  probeOmlxRuntime,
  requireMacTarget,
  verifyOmlxApp,
  verifyLaunchAgentCustody,
} from './macos';
import {
  inferenceSpecSchema,
  inferenceStateDirectory,
  modelIdentity,
  OMLX_RUNTIME,
  type InferenceFetch,
  type InferenceNode,
  type InferenceSpec,
} from './model';
import { installModel, retainedModelBytes, verifyModel } from './models';
import {
  admitInference,
  admitInferenceHost,
  type InferenceHardware,
} from './plan';
import {
  memoryProofSchema,
  observeMemoryPressure,
  withMemoryAdmission,
} from './pressure';
import {
  containsSettings,
  inferenceSecrets,
  launchAgentPlist,
  omlxModelSettings,
  omlxSettings,
  secretIdentity,
  type InferenceSecrets,
} from './settings';
import { inferenceSourceSchema } from './source';

const releaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bundleSha256: sha,
  spec: inferenceSpecSchema,
  source: inferenceSourceSchema.optional(),
  node: slug,
  memoryBytes: z.number().int().positive().safe(),
  secretsSha256: sha,
  release: sha,
});
type Release = z.infer<typeof releaseSchema>;
const currentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    phase: z.enum(['pending', 'ready']),
    release: sha,
    previous: sha.optional(),
    node: slug,
    organization: slug,
    observedAt: z.string().datetime(),
    capabilities: z.array(capabilityProofSchema).max(32).optional(),
    mixedCapabilities: z.array(capabilityProofSchema).max(3).optional(),
    memory: memoryProofSchema.optional(),
  })
  .superRefine((state, context) => {
    if (
      state.phase === 'ready' &&
      (!state.capabilities || !state.mixedCapabilities || !state.memory)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Ready inference requires completed capability, mixed-workload and memory proofs',
      });
  });
type Current = z.infer<typeof currentSchema>;
export interface InferenceOperations {
  assertTarget: typeof requireMacTarget;
  hardware: typeof observeMacHardware;
  runtime: typeof installOmlxRuntime;
  probe: typeof probeOmlxRuntime;
  verifyRuntime: typeof verifyOmlxApp;
  model: typeof installModel;
  verifyModel: typeof verifyModel;
  retainedModelBytes: typeof retainedModelBytes;
  activate: typeof activateLaunchAgent;
  running: typeof launchAgentMatches;
  serviceCustody: typeof verifyLaunchAgentCustody;
  api: typeof verifyInferenceApi;
  benchmark: typeof benchmarkCapabilities;
  memory: typeof observeMemoryPressure;
  /** Owned fixture isolation only; commands never expose a state-path override. */
  stateDirectory: typeof inferenceStateDirectory;
  directory: typeof privateDirectory;
  wait: (milliseconds: number) => Promise<void>;
  fetch: InferenceFetch;
}
const defaults: InferenceOperations = {
  assertTarget: requireMacTarget,
  hardware: observeMacHardware,
  runtime: installOmlxRuntime,
  probe: probeOmlxRuntime,
  verifyRuntime: verifyOmlxApp,
  model: installModel,
  verifyModel,
  retainedModelBytes,
  activate: activateLaunchAgent,
  running: launchAgentMatches,
  serviceCustody: verifyLaunchAgentCustody,
  api: verifyInferenceApi,
  benchmark: benchmarkCapabilities,
  memory: observeMemoryPressure,
  stateDirectory: inferenceStateDirectory,
  directory: privateDirectory,
  wait: (ms) => Bun.sleep(ms),
  fetch,
};

function releaseIdentity(record: Omit<Release, 'release'>): string {
  return valueHash(record);
}
function selected(spec: InferenceSpec, key: string): InferenceNode {
  const node = spec.nodes.find((item) => item.key === key);
  if (!node)
    throw preconditionError('The selected inference node is not declared.');
  return node;
}
async function currentState(
  state: string,
  uid: number,
): Promise<Current | undefined> {
  const value = await readOptionalJson(join(state, 'current.json'));
  if (value === undefined) return undefined;
  await readPrivateJson(join(state, 'current.json'), uid);
  const parsed = currentSchema.safeParse(value);
  if (!parsed.success)
    throw preconditionError(
      'Inference recovery state is invalid. Retain it for review.',
    );
  return parsed.data;
}
async function readRelease(
  state: string,
  release: string,
  uid: number,
): Promise<Release> {
  sha.parse(release);
  const parsed = releaseSchema.safeParse(
    await readPrivateJson(
      join(state, 'releases', release, 'release.json'),
      uid,
    ),
  );
  if (!parsed.success)
    throw preconditionError('The retained inference release is invalid.');
  const { release: actual, ...body } = parsed.data;
  if (
    actual !== release ||
    releaseIdentity(body) !== release ||
    inferenceBundleHash(body.spec, body.source) !== body.bundleSha256
  )
    throw preconditionError(
      'Retained inference release identity differs from its bytes.',
    );
  return parsed.data;
}
async function ensurePrivateFile(
  file: string,
  expected: unknown,
  uid: number,
  exact = false,
): Promise<void> {
  const prior = await readOptionalJson(file);
  if (prior !== undefined) {
    await readPrivateJson(file, uid);
    if (
      exact
        ? valueHash(prior) !== valueHash(expected)
        : !containsSettings(prior, expected)
    )
      throw preconditionError(
        'Retained inference settings differ; no private state was overwritten.',
      );
  } else await writePrivateJson(file, expected);
}
async function stageRelease(
  state: string,
  record: Release,
  node: InferenceNode,
  secrets: InferenceSecrets,
  uid: number,
  app: string,
) {
  const directory = join(state, 'releases', record.release);
  await ownedDirectory(directory, state);
  await ensurePrivateFile(join(directory, 'release.json'), record, uid);
  await ensurePrivateFile(
    join(directory, 'settings.json'),
    omlxSettings(
      record.spec,
      node,
      state,
      record.release,
      secrets,
      record.memoryBytes,
    ),
    uid,
  );
  await ensurePrivateFile(
    join(directory, 'admission.json'),
    admissionPolicy(record.spec, node),
    uid,
    true,
  );
  const adapter = join(directory, INFERENCE_ADMISSION_FILENAME);
  try {
    await lstat(adapter);
    if (
      (await fileDigest(
        adapter,
        Buffer.byteLength(INFERENCE_ADMISSION_SOURCE),
        uid,
      )) !== INFERENCE_ADMISSION_SHA
    )
      throw preconditionError(
        'Retained inference admission adapter differs; activation is held.',
      );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
    await writePrivateText(adapter, INFERENCE_ADMISSION_SOURCE);
  }
  await ensurePrivateFile(
    join(directory, 'model_settings.json'),
    omlxModelSettings(record.spec, node),
    uid,
  );
  const plist = join(directory, 'launch-agent.plist');
  const expectedPlist = launchAgentPlist(node, state, record.release, app);
  try {
    await lstat(plist);
    if (!(await persistedPlistMatches(plist, expectedPlist)))
      throw preconditionError(
        'Retained inference LaunchAgent differs; activation is held.',
      );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
    await writeFile(plist, expectedPlist, { flag: 'wx', mode: 0o600 });
  }
  for (const path of ['logs', `cache/${record.release}`])
    await ownedDirectory(join(state, path), state);
  await excludeRegenerableDirectory(join(state, 'cache'), state);
  return plist;
}
async function releaseSecrets(
  state: string,
  record: Release,
  uid: number,
): Promise<InferenceSecrets> {
  const file = await readPrivateJson(
    join(state, 'releases', record.release, 'settings.json'),
    uid,
  );
  const parsed = z
    .object({
      auth: z.object({
        api_key: z.string(),
        sub_keys: z.array(z.object({ key: z.string() })).length(1),
      }),
    })
    .safeParse(file);
  if (!parsed.success)
    throw preconditionError('Retained inference credentials are invalid.');
  const node = selected(record.spec, record.node);
  const secrets = inferenceSecrets(record.spec, node, {
    [node.adminKey.env]: parsed.data.auth.api_key,
    [record.spec.serviceKey.env]: parsed.data.auth.sub_keys[0].key,
  });
  if (secretIdentity(secrets) !== record.secretsSha256)
    throw preconditionError(
      'Retained inference credentials differ from the recorded release.',
    );
  return secrets;
}
async function verifyReleaseFiles(
  state: string,
  record: Release,
  node: InferenceNode,
  secrets: InferenceSecrets,
  uid: number,
  operations: InferenceOperations,
): Promise<void> {
  const app = join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app');
  await operations.verifyRuntime(app);
  const base = join(state, 'releases', record.release);
  if (
    valueHash(await readPrivateJson(join(base, 'admission.json'), uid)) !==
      valueHash(admissionPolicy(record.spec, node)) ||
    (await fileDigest(
      join(base, INFERENCE_ADMISSION_FILENAME),
      Buffer.byteLength(INFERENCE_ADMISSION_SOURCE),
      uid,
    )) !== INFERENCE_ADMISSION_SHA ||
    !containsSettings(
      await readPrivateJson(join(base, 'settings.json'), uid),
      omlxSettings(
        record.spec,
        node,
        state,
        record.release,
        secrets,
        record.memoryBytes,
      ),
    ) ||
    !containsSettings(
      await readPrivateJson(join(base, 'model_settings.json'), uid),
      omlxModelSettings(record.spec, node),
    ) ||
    !(await persistedPlistMatches(
      join(base, 'launch-agent.plist'),
      launchAgentPlist(node, state, record.release, app),
    ))
  )
    throw preconditionError(
      'Inference settings or launch arguments drifted from the selected release.',
    );
  for (const model of record.spec.models.filter((entry) =>
    node.models.includes(entry.key),
  ))
    await operations.verifyModel(state, model);
}
async function ensureIdle(
  node: InferenceNode,
  key: string,
  operations: InferenceOperations,
): Promise<void> {
  await requireIdleInference(node, key, operations.fetch);
}
function safeResult(
  record: Release,
  unchanged: boolean,
  admission: InferenceAdmission,
) {
  const node = selected(record.spec, record.node);
  return {
    ready: true as const,
    unchanged,
    bundleSha256: record.bundleSha256,
    release: record.release,
    organization: record.spec.organization,
    node: node.key,
    address: node.address,
    port: node.port,
    runtimeVersion: OMLX_RUNTIME.version,
    runtimeSha256: OMLX_RUNTIME.sha256,
    models: record.spec.models
      .filter((model) => node.models.includes(model.key))
      .map((model) => ({
        key: model.key,
        apiModel: model.apiModel,
        identity: modelIdentity(model),
        capability: model.capability,
        configurationProjection: model.configurationProjection ?? null,
      })),
    observedAt: new Date().toISOString(),
    performanceMeasured: true as const,
    capabilitiesVerified: true as const,
    boundedBenchmarkVerified: true as const,
    sustainedLoadMeasured: false as const,
    admission: {
      adapterSha256: admission.adapterSha256,
      policySha256: admission.policySha256,
      residency: admission.residency,
      maximumConcurrency: admission.maximumConcurrency,
      loadedRoles: admission.models
        .filter((model) => model.loaded)
        .map((model) => model.key),
    },
  };
}
function requireCapabilityProof(current: Current, record: Release): void {
  const models = record.spec.models.filter((model) =>
    selected(record.spec, record.node).models.includes(model.key),
  );
  if (
    !current.capabilities ||
    current.capabilities.length !== models.length ||
    models.some(
      (model) =>
        current.capabilities?.filter(
          (proof) =>
            proof.identity === modelIdentity(model) &&
            proof.model === model.apiModel &&
            proof.capability === model.capability &&
            proof.toolCallVerified === (model.capability === 'text') &&
            (proof.toolCallDurationMs !== null) ===
              (model.capability === 'text') &&
            proof.embeddingDimensions === (model.embeddingDimensions ?? null) &&
            proof.embeddingBatchSize ===
              (model.capability === 'embedding' ? 64 : null) &&
            (model.capability !== 'embedding' || proof.durationMs < 60_000),
        ).length !== 1,
    )
  )
    throw preconditionError(
      'Retained capability proof differs from the exact model identities.',
    );
  if (
    !current.mixedCapabilities ||
    current.mixedCapabilities.length !== models.length ||
    models.some(
      (model) =>
        current.mixedCapabilities?.filter(
          (proof) =>
            proof.identity === modelIdentity(model) &&
            proof.model === model.apiModel &&
            proof.capability === model.capability &&
            proof.toolCallVerified === (model.capability === 'text') &&
            (proof.toolCallDurationMs !== null) ===
              (model.capability === 'text') &&
            proof.embeddingDimensions === (model.embeddingDimensions ?? null) &&
            proof.embeddingBatchSize ===
              (model.capability === 'embedding' ? 64 : null) &&
            (model.capability !== 'embedding' || proof.durationMs < 60_000),
        ).length !== 1,
    ) ||
    !current.memory
  )
    throw preconditionError(
      'Retained mixed-workload or memory admission proof is incomplete.',
    );
}

async function activate(
  state: string,
  record: Release,
  secrets: InferenceSecrets,
  hardware: InferenceHardware,
  operations: InferenceOperations,
  rollback: boolean,
) {
  const node = selected(record.spec, record.node);
  const previous = await currentState(state, hardware.uid);
  await operations.serviceCustody(
    node,
    hardware.uid,
    state,
    previous
      ? [previous.release, ...(previous.previous ? [previous.previous] : [])]
      : [],
  );
  if (
    previous &&
    (previous.node !== node.key ||
      previous.organization !== record.spec.organization)
  )
    throw preconditionError(
      'Inference state belongs to a different node or organization.',
    );
  if (
    previous?.phase === 'pending' &&
    previous.release !== record.release &&
    !rollback
  )
    throw preconditionError(
      'Another inference release is pending. Resume that exact release or explicitly roll back to a retained ready release.',
    );
  const same =
    previous?.phase === 'ready' && previous.release === record.release;
  await verifyReleaseFiles(
    state,
    record,
    node,
    secrets,
    hardware.uid,
    operations,
  );
  if (same) {
    requireCapabilityProof(previous, record);
    if (!(await operations.running(node, hardware.uid, state, record.release)))
      throw preconditionError(
        'Recorded inference service is not running its exact LaunchAgent. Inspect it before changing state.',
      );
    const api = await operations.api(
      record.spec,
      node,
      secrets.serviceKey,
      operations.fetch,
    );
    return safeResult(record, true, api.admission);
  }
  if (previous && previous.release !== record.release) {
    const old = await readRelease(state, previous.release, hardware.uid);
    const oldSecrets = await releaseSecrets(state, old, hardware.uid);
    if (
      previous.phase === 'ready' ||
      (await operations.running(node, hardware.uid, state, previous.release))
    )
      await ensureIdle(node, oldSecrets.adminKey, operations);
  }
  const pending: Current = {
    schemaVersion: 1,
    phase: 'pending',
    release: record.release,
    ...(previous
      ? {
          previous:
            previous.phase === 'ready' ? previous.release : previous.previous,
        }
      : {}),
    node: node.key,
    organization: record.spec.organization,
    observedAt: new Date().toISOString(),
  };
  await writePrivateJson(join(state, 'current.json'), pending);
  // Response loss after bootstrap is recoverable without restarting a healthy
  // service: match the exact loaded job before deciding to submit it again.
  if (!(await operations.running(node, hardware.uid, state, record.release)))
    await operations.activate(
      node,
      hardware.uid,
      join(state, 'releases', record.release, 'launch-agent.plist'),
    );
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await operations.api(
        record.spec,
        node,
        secrets.serviceKey,
        operations.fetch,
      );
      healthy = true;
      break;
    } catch (error) {
      if (error instanceof CliError && error.info.code === 3) throw error;
    }
    await operations.wait(10_000);
  }
  if (!healthy)
    throw externalDepError(
      'Inference did not become ready within ten minutes. Keep the pending receipt; resume or roll back after inspecting the target.',
    );
  const measured = await withMemoryAdmission(
    () =>
      operations.benchmark(
        record.spec,
        node,
        secrets.serviceKey,
        operations.fetch,
      ),
    operations.memory,
  );
  const capabilities = measured.result.baseline;
  const mixedCapabilities = measured.result.mixed;
  const memory = measured.memory;
  requireCapabilityProof(
    { ...pending, phase: 'ready', capabilities, mixedCapabilities, memory },
    record,
  );
  await verifyReleaseFiles(
    state,
    record,
    node,
    secrets,
    hardware.uid,
    operations,
  );
  if (!(await operations.running(node, hardware.uid, state, record.release)))
    throw preconditionError(
      'Inference process changed before the ready receipt could be recorded.',
    );
  const finalApi = await operations.api(
    record.spec,
    node,
    secrets.serviceKey,
    operations.fetch,
  );
  await writePrivateJson(join(state, 'current.json'), {
    ...pending,
    phase: 'ready',
    capabilities,
    mixedCapabilities,
    memory,
    observedAt: new Date().toISOString(),
  });
  return safeResult(record, false, finalApi.admission);
}

export async function applyInference(
  options: { bundle: string; bundleSha256: string; node: string },
  dependencies: Partial<InferenceOperations> = {},
  environment = process.env,
) {
  const operations = { ...defaults, ...dependencies };
  operations.assertTarget();
  const bundle = await verifyInferenceBundle(
    options.bundle,
    options.bundleSha256,
  );
  const node = selected(bundle.spec, options.node);
  const initial = await operations.hardware();
  admitInferenceHost(bundle.spec, node.key, initial);
  const secrets = inferenceSecrets(bundle.spec, node, environment);
  const state = operations.stateDirectory(node);
  await operations.directory(state, initial.home, initial.uid);
  return withLock(state, 'inference apply', async () => {
    const prior = await currentState(state, initial.uid);
    await operations.serviceCustody(
      node,
      initial.uid,
      state,
      prior ? [prior.release, ...(prior.previous ? [prior.previous] : [])] : [],
    );
    if (
      prior &&
      (prior.node !== node.key ||
        prior.organization !== bundle.spec.organization)
    )
      throw preconditionError(
        'Inference state belongs to a different node or organization.',
      );
    if (prior?.phase === 'pending') {
      const pending = await readRelease(state, prior.release, initial.uid);
      if (
        pending.bundleSha256 !== bundle.bundleSha256 ||
        pending.secretsSha256 !== secretIdentity(secrets)
      )
        throw preconditionError(
          'Another inference release is pending. Resume that exact release or explicitly roll back.',
        );
    }
    let retainedBytes = 0;
    for (const model of bundle.spec.models.filter((entry) =>
      node.models.includes(entry.key),
    ))
      retainedBytes += await operations.retainedModelBytes(state, model);
    admitInference(bundle.spec, node.key, initial, true, retainedBytes);
    const app = await operations.runtime(state);
    const hardware = { ...initial, ...(await operations.probe(app, node)) };
    admitInference(bundle.spec, node.key, hardware, false, retainedBytes);
    for (const model of bundle.spec.models.filter((entry) =>
      node.models.includes(entry.key),
    ))
      await operations.model(state, model);
    // Weight acquisition can take hours. Reobserve the actual host-owned cap
    // immediately before activation rather than trusting preparation-time RAM.
    const admitted = {
      ...(await operations.hardware()),
      ...(await operations.probe(app, node)),
    };
    if (
      admitted.uid !== initial.uid ||
      admitted.memoryBytes !== initial.memoryBytes
    )
      throw preconditionError(
        'Inference host identity or physical memory changed during staging.',
      );
    const stagedModelBytes = bundle.spec.models
      .filter((model) => node.models.includes(model.key))
      .reduce(
        (sum, model) =>
          sum + model.files.reduce((total, file) => total + file.bytes, 0),
        0,
      );
    admitInference(bundle.spec, node.key, admitted, false, stagedModelBytes);
    const body = {
      schemaVersion: 1 as const,
      bundleSha256: bundle.bundleSha256,
      spec: bundle.spec,
      ...(bundle.source ? { source: bundle.source } : {}),
      node: node.key,
      memoryBytes: hardware.memoryBytes,
      secretsSha256: secretIdentity(secrets),
    };
    const record = { ...body, release: releaseIdentity(body) };
    await stageRelease(state, record, node, secrets, hardware.uid, app);
    return activate(state, record, secrets, admitted, operations, false);
  });
}

export async function statusInference(
  options: { bundle: string; bundleSha256: string; node: string },
  dependencies: Partial<InferenceOperations> = {},
) {
  const operations = { ...defaults, ...dependencies };
  operations.assertTarget();
  const bundle = await verifyInferenceBundle(
    options.bundle,
    options.bundleSha256,
  );
  const node = selected(bundle.spec, options.node);
  const hardware = await operations.hardware();
  admitInferenceHost(bundle.spec, node.key, hardware);
  const state = operations.stateDirectory(node);
  const current = await currentState(state, hardware.uid);
  if (!current || current.phase !== 'ready')
    return {
      ready: false as const,
      node: node.key,
      phase: current?.phase ?? 'absent',
    };
  const record = await readRelease(state, current.release, hardware.uid);
  if (record.bundleSha256 !== bundle.bundleSha256 || record.node !== node.key)
    throw preconditionError(
      'Active inference release differs from the selected bundle.',
    );
  requireCapabilityProof(current, record);
  const secrets = await releaseSecrets(state, record, hardware.uid);
  await verifyReleaseFiles(
    state,
    record,
    node,
    secrets,
    hardware.uid,
    operations,
  );
  const app = join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app');
  const admitted = { ...hardware, ...(await operations.probe(app, node)) };
  const verifiedBytes = bundle.spec.models
    .filter((model) => node.models.includes(model.key))
    .reduce(
      (sum, model) =>
        sum + model.files.reduce((total, file) => total + file.bytes, 0),
      0,
    );
  admitInference(bundle.spec, node.key, admitted, false, verifiedBytes);
  if (!(await operations.running(node, hardware.uid, state, record.release)))
    return { ready: false as const, node: node.key, phase: 'stopped' };
  const api = await operations.api(
    bundle.spec,
    node,
    secrets.serviceKey,
    operations.fetch,
  );
  return safeResult(record, true, api.admission);
}

export async function rollbackInference(
  options: {
    bundle: string;
    bundleSha256: string;
    node: string;
    release: string;
  },
  dependencies: Partial<InferenceOperations> = {},
) {
  const operations = { ...defaults, ...dependencies };
  operations.assertTarget();
  const bundle = await verifyInferenceBundle(
    options.bundle,
    options.bundleSha256,
  );
  const node = selected(bundle.spec, options.node);
  const initial = await operations.hardware();
  admitInferenceHost(bundle.spec, node.key, initial);
  const state = operations.stateDirectory(node);
  await operations.directory(state, initial.home, initial.uid);
  return withLock(state, 'inference rollback', async () => {
    const record = await readRelease(state, options.release, initial.uid);
    if (record.bundleSha256 !== bundle.bundleSha256 || record.node !== node.key)
      throw preconditionError(
        'Rollback target differs from the selected retained bundle.',
      );
    const current = await currentState(state, initial.uid);
    if (
      !current ||
      (current.release !== record.release &&
        current.previous !== record.release)
    )
      throw preconditionError(
        'Rollback requires the current or immediately retained prior ready release.',
      );
    let retainedBytes = 0;
    for (const model of bundle.spec.models.filter((entry) =>
      node.models.includes(entry.key),
    ))
      retainedBytes += await operations.retainedModelBytes(state, model);
    const app = await operations.runtime(state);
    const hardware = { ...initial, ...(await operations.probe(app, node)) };
    admitInference(bundle.spec, node.key, hardware, false, retainedBytes);
    const secrets = await releaseSecrets(state, record, hardware.uid);
    return activate(state, record, secrets, hardware, operations, true);
  });
}

/** Explicit inference work, separate from read-only status. It uses the ready
 * release's private service key and serializes with activation/rollback. */
export async function benchmarkInference(
  options: { bundle: string; bundleSha256: string; node: string },
  dependencies: Partial<InferenceOperations> = {},
) {
  const operations = { ...defaults, ...dependencies };
  operations.assertTarget();
  const verified = await statusInference(options, operations);
  if (!verified.ready)
    throw preconditionError(
      'Benchmark requires an exact ready inference release.',
    );
  const bundle = await verifyInferenceBundle(
    options.bundle,
    options.bundleSha256,
  );
  const node = selected(bundle.spec, options.node);
  const hardware = await operations.hardware();
  const state = operations.stateDirectory(node);
  return withLock(state, 'inference benchmark', async () => {
    const current = await currentState(state, hardware.uid);
    if (
      !current ||
      current.phase !== 'ready' ||
      current.release !== verified.release
    )
      throw preconditionError(
        'Inference release changed before the benchmark.',
      );
    const record = await readRelease(state, current.release, hardware.uid);
    const secrets = await releaseSecrets(state, record, hardware.uid);
    await ensureIdle(node, secrets.adminKey, operations);
    const measured = await withMemoryAdmission(
      () =>
        operations.benchmark(
          bundle.spec,
          node,
          secrets.serviceKey,
          operations.fetch,
        ),
      operations.memory,
    );
    const result = measured.result;
    const receipt = {
      schemaVersion: 1,
      bundleSha256: bundle.bundleSha256,
      release: record.release,
      node: node.key,
      ...result,
      memory: measured.memory,
    };
    await writePrivateJson(
      join(state, 'releases', record.release, 'benchmark.json'),
      receipt,
    );
    return receipt;
  });
}
