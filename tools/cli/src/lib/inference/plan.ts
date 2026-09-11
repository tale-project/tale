import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import {
  GIB,
  OMLX_RUNTIME,
  type InferenceNode,
  type InferenceSpec,
} from './model';

export const hardwareSchema = z.strictObject({
  platform: z.string(),
  architecture: z.string(),
  macOSMajor: z.number().int().nonnegative(),
  user: z.string(),
  home: z.string(),
  hostName: z.string(),
  uid: z.number().int().nonnegative(),
  administrator: z.boolean(),
  launchdUserDomain: z.boolean(),
  addresses: z.array(z.string()).max(256),
  memoryBytes: z.number().int().positive().safe(),
  freeDiskBytes: z.number().int().nonnegative().safe(),
  /** Available only after the verified runtime probes its actual Metal device. */
  metalWorkingSetBytes: z.number().int().positive().safe().optional(),
  /** Zero means Apple's default; positive is an already configured kernel cap.
   * Observation only: this CLI never writes the host-wide iogpu setting. */
  metalWiredLimitBytes: z.number().int().nonnegative().safe().optional(),
  availableKernels: z.array(z.string()).max(64).optional(),
});
export type InferenceHardware = z.infer<typeof hardwareSchema>;

function hostReasons(
  node: InferenceNode,
  hardware: InferenceHardware,
): string[] {
  const reasons: string[] = [];
  if (
    hardware.platform !== 'darwin' ||
    hardware.architecture !== 'arm64' ||
    hardware.macOSMajor < OMLX_RUNTIME.minimumMacOS
  )
    reasons.push('This runtime requires macOS 15 or later on Apple Silicon.');
  if (
    hardware.user !== node.user ||
    hardware.home !== `/Users/${node.user}` ||
    hardware.hostName !== node.hostName ||
    hardware.uid < 501 ||
    hardware.administrator
  )
    reasons.push(
      'The destination must be the declared standard macOS user and host.',
    );
  if (!hardware.launchdUserDomain)
    reasons.push(
      'The declared user needs an available graphical launchd domain.',
    );
  if (!hardware.addresses.includes(node.address))
    reasons.push(
      'The declared private API address is not assigned to this host.',
    );
  return reasons;
}

export function admitInferenceHost(
  spec: InferenceSpec,
  nodeKey: string,
  hardware: InferenceHardware,
): void {
  const node = spec.nodes.find((entry) => entry.key === nodeKey);
  if (!node)
    throw preconditionError('The selected inference node is not declared.');
  const reasons = hostReasons(node, hardware);
  if (reasons.length)
    throw preconditionError(
      'Inference admission refused. ' + reasons.join(' '),
    );
}

/** Estimates are conservative admission floors, never measured throughput or
 * a claim that arbitrary prompts fit. The runtime memory guard remains active. */
export function planInference(
  spec: InferenceSpec,
  hardware?: InferenceHardware,
  retainedBytes: Readonly<Record<string, number>> = {},
) {
  return spec.nodes.map((node) => {
    const models = spec.models.filter((model) =>
      node.models.includes(model.key),
    );
    const modelBytes = models.reduce(
      (total, model) =>
        total + model.files.reduce((sum, file) => sum + file.bytes, 0),
      0,
    );
    const weightsBytes = models.reduce(
      (total, model) =>
        total +
        model.files
          .filter((file) => file.path.endsWith('.safetensors'))
          .reduce((sum, file) => sum + file.bytes, 0),
      0,
    );
    const largestRoleWeightsBytes = Math.max(
      ...models.map((model) =>
        model.files
          .filter((file) => file.path.endsWith('.safetensors'))
          .reduce((sum, file) => sum + file.bytes, 0),
      ),
    );
    // One native admission gate serializes every role. Idle models are
    // evictable; disk holds all pins, while active capacity covers the largest
    // role. Cold-switch latency must be measured on the actual destination.
    const workingHeadroomBytes =
      Math.max(8 * GIB, Math.ceil(largestRoleWeightsBytes * 0.15)) *
      spec.limits.concurrency;
    const workingBytes =
      largestRoleWeightsBytes +
      workingHeadroomBytes +
      spec.limits.hotCacheBytes;
    const requiredMemoryBytes = workingBytes + spec.limits.memoryReserveBytes;
    // A download is staged beside retained releases. Existing bytes are not
    // subtracted without a complete on-target hash verification.
    const verifiedRetainedBytes = retainedBytes[node.key] ?? 0;
    if (
      !Number.isSafeInteger(verifiedRetainedBytes) ||
      verifiedRetainedBytes < 0 ||
      verifiedRetainedBytes > modelBytes
    )
      throw preconditionError(
        'Verified retained model byte credit is invalid.',
      );
    const requiredFreeDiskBytes =
      modelBytes -
      verifiedRetainedBytes +
      OMLX_RUNTIME.bytes * 4 +
      spec.limits.ssdCacheBytes +
      spec.limits.diskReserveBytes;
    const reasons: string[] = [];
    const effectiveMetalLimitBytes = hardware
      ? hardware.metalWiredLimitBytes || hardware.metalWorkingSetBytes || null
      : null;
    const softTargetBytes =
      hardware && effectiveMetalLimitBytes
        ? Math.floor(
            Math.min(
              hardware.memoryBytes - spec.limits.memoryReserveBytes,
              effectiveMetalLimitBytes,
            ) * 0.85,
          )
        : null;
    if (spec.mode !== 'replicas')
      reasons.push(
        'Experimental sharding has no admitted hardware/model proof. Use independent replicas or perform a separate upstream cluster validation.',
      );
    if (!hardware) reasons.push('Destination hardware has not been observed.');
    else {
      reasons.push(...hostReasons(node, hardware));
      if (hardware.memoryBytes < requiredMemoryBytes)
        reasons.push(
          'Physical memory is below the model and reserved working-memory floor.',
        );
      if (hardware.freeDiskBytes < requiredFreeDiskBytes)
        reasons.push(
          'Free disk is below the staged model, runtime, cache and reserve floor.',
        );
      if (
        softTargetBytes !== null &&
        largestRoleWeightsBytes >= softTargetBytes
      )
        reasons.push(
          'The largest role alone reaches the runtime soft admission target; it cannot be admitted safely.',
        );
      if (hardware.metalWorkingSetBytes === undefined)
        reasons.push('Metal working-set capacity has not been observed.');
      else if (
        (hardware.metalWiredLimitBytes || hardware.metalWorkingSetBytes) <
        workingBytes
      )
        reasons.push(
          'Metal effective working-set capacity is below the model and working-memory floor.',
        );
      const kernels = new Set(hardware.availableKernels ?? []);
      if (
        models.some((model) =>
          model.requiredKernels.some((kernel) => !kernels.has(kernel)),
        )
      )
        reasons.push(
          'A required native kernel has not passed its runtime import check.',
        );
    }
    return {
      node: node.key,
      modelBytes,
      configurationProjections: models
        .filter((model) => model.configurationProjection)
        .map((model) =>
          Object.assign({ key: model.key }, model.configurationProjection),
        ),
      verifiedRetainedBytes,
      weightsBytes,
      largestRoleWeightsBytes,
      residency: 'evictable-on-demand' as const,
      maximumConcurrentRoles: 1 as const,
      softTargetBytes,
      coldSwitchLatencyMeasured: false as const,
      workingHeadroomBytes,
      metalWorkingSetBytes: hardware?.metalWorkingSetBytes ?? null,
      metalWiredLimitBytes: hardware?.metalWiredLimitBytes ?? null,
      effectiveMetalLimitBytes,
      requiredMemoryBytes,
      requiredFreeDiskBytes,
      performanceMeasured: false as const,
      ready: reasons.length === 0,
      reasons,
    };
  });
}

export function admitInference(
  spec: InferenceSpec,
  nodeKey: string,
  hardware: InferenceHardware,
  beforeRuntime = false,
  retainedBytes = 0,
) {
  const result = planInference(spec, hardware, {
    [nodeKey]: retainedBytes,
  }).find((node) => node.node === nodeKey);
  if (!result)
    throw preconditionError('The selected inference node is not declared.');
  const reasons = beforeRuntime
    ? result.reasons.filter(
        (reason) =>
          reason !== 'Metal working-set capacity has not been observed.' &&
          !reason.startsWith('A required native kernel'),
      )
    : result.reasons;
  if (reasons.length)
    throw preconditionError(
      'Inference admission refused. ' + reasons.join(' '),
    );
  return result;
}
