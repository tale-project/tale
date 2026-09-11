import { admissionPolicy, INFERENCE_ADMISSION_SHA } from '../admission';
import {
  GIB,
  modelIdentity,
  type InferenceNode,
  type InferenceSpec,
} from '../model';

export function admissionFixture(
  spec: InferenceSpec,
  node: InferenceNode,
  loaded = node.models,
) {
  return {
    schemaVersion: 1,
    adapterSha256: INFERENCE_ADMISSION_SHA,
    policySha256: admissionPolicy(spec, node).policySha256,
    residency: 'evictable-on-demand' as const,
    maximumConcurrency: 1,
    queueLimit: spec.limits.queuedRequests,
    ready: true,
    phase: 'idle' as const,
    activeRole: null,
    queued: 0,
    preparing: 0,
    completed: 8,
    rejected: 0,
    cancelled: 0,
    maximumObservedActive: 1,
    maximumObservedWaiting: 0,
    models: spec.models
      .filter((model) => node.models.includes(model.key))
      .map((model) => ({
        key: model.key,
        identity: modelIdentity(model),
        loaded: loaded.includes(model.key),
        loading: false,
      })),
  };
}

export const admissionHeaders = {
  'x-tale-admission-sha256': INFERENCE_ADMISSION_SHA,
  'x-tale-model-cold': 'false',
  'x-tale-queue-ms': '0',
};

/** Synthetic metadata only: these hashes never stand in for real model bytes. */
export function inferenceFixture() {
  return {
    schemaVersion: 1,
    name: 'local-models',
    organization: 'synthetic-client',
    runtime: 'omlx-0.6.4-macos15',
    models: [
      {
        key: 'reasoning',
        repository: 'example/model',
        revision: 'a'.repeat(40),
        apiModel: 'Example-Model',
        capability: 'text',
        modelType: 'glm_moe_dsa',
        contextTokens: 16384,
        requiredKernels: ['glm_moe_dsa'],
        files: [
          { path: 'config.json', bytes: 100, sha256: 'a'.repeat(64) },
          { path: 'model.safetensors', bytes: 4 * GIB, sha256: 'b'.repeat(64) },
        ],
      },
    ],
    nodes: [
      {
        key: 'studio-one',
        user: 'inference',
        hostName: 'studio-one',
        address: '10.70.0.10',
        models: ['reasoning'],
        adminKey: { env: 'TALE_INFERENCE_STUDIO_ADMIN_KEY' },
      },
    ],
    serviceKey: { env: 'TALE_SECRETS_INFERENCE_API_KEY' },
  };
}
