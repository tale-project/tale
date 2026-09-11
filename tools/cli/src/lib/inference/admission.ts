import { posix as path } from 'node:path';

import { sha256, valueHash } from '../config/releases/identity';
import {
  inferenceStateDirectory,
  modelIdentity,
  runtimeModelDirectory,
  type InferenceNode,
  type InferenceSpec,
} from './model';
import source from './runtime-admission.py' with { type: 'text' };

export const INFERENCE_ADMISSION_SOURCE = source;
export const INFERENCE_ADMISSION_SHA = sha256(source);
export const INFERENCE_ADMISSION_FILENAME = 'runtime-admission.py';

/** The adapter is bound as complete bytes, separately from the unchanged
 * signed oMLX app. Its public policy is identical in preparation and on target. */
export function admissionPolicy(spec: InferenceSpec, node: InferenceNode) {
  const state = inferenceStateDirectory(node);
  const policy = {
    schemaVersion: 1,
    adapterSha256: INFERENCE_ADMISSION_SHA,
    node: node.key,
    organization: spec.organization,
    concurrency: 1,
    queuedRequests: spec.limits.queuedRequests,
    queueTimeoutSeconds: spec.limits.queueTimeoutSeconds,
    requestTimeoutSeconds: spec.limits.requestTimeoutSeconds,
    bodyTimeoutSeconds: 15,
    maximumBodyBytes: 32 * 1024 * 1024,
    models: spec.models
      .filter((model) => node.models.includes(model.key))
      .map((model) => ({
        key: model.key,
        apiModel: model.apiModel,
        identity: modelIdentity(model),
        capability: model.capability,
        modelPath: path.normalize(runtimeModelDirectory(state, model)),
        maxTokens: Math.min(4096, Math.floor(model.contextTokens / 4)),
      })),
  };
  return { ...policy, policySha256: valueHash(policy) };
}
