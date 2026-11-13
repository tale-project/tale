/**
 * The compiled stack of a managed deployment on Incus (design D-39): what
 * `deploy prepare` pins in the bundle as `incus-stack.json`, and what
 * `deploy --bundle` compiles again from the deployment's own `.env` and holds
 * to it. Pure: it reads no node and no file.
 */

import { stableJson } from '../config/releases/identity';
import type { ImageFacts } from '../oci/image-facts';
import { addressPlan } from '../runtime/incus/compile/address-plan';
import { interpolationSource } from '../runtime/incus/compile/interpolate';
import {
  compileStackTarget,
  requireStackTarget,
  type IncusDeclaration,
  type StackTarget,
} from '../runtime/incus/compile/stack-target';
import {
  requireRuntime,
  type PrepareIncusOptions,
  type RuntimePlatform,
} from './runtime-model';
import type { SandboxPrepare } from './runtime-sandbox';

/** The refusal of a stack that differs from the prepared one. */
export const PREPARED_STACK_SENTENCE =
  'The Incus stack compiled from this deployment differs from the stack the bundle was prepared with; prepare the bundle again.';

/** The Incus sandbox of a deployment, on the address plan: the sessions
 * reach the backend API through the switch, and egress through the declared
 * proxy, else the stack's own (R-13). */
export function incusSandboxDeclaration(
  incus: Pick<PrepareIncusOptions, 'declaration' | 'egressProxy'>,
): SandboxPrepare {
  const plan = addressPlan(incus.declaration.network, 'managed', {
    platform: 1,
    'backend-api': 1,
    'backend-worker': 1,
  });
  return {
    address: plan.singleton('switch'),
    egressProxy:
      incus.egressProxy ?? `http://${plan.singleton('sandbox-egress')}:3128`,
  };
}

export interface CompileIncusStackInput {
  compose: unknown;
  /** The deployment's `.env` (empty at prepare: no secret is known yet). */
  dotenv: string;
  declaration: IncusDeclaration;
  stack: string;
  platform: RuntimePlatform;
  /** Image facts by the reference the compose file names. */
  facts: ReadonlyMap<string, ImageFacts>;
  egressProxy?: string;
}

/** Compile the managed stack from the bundle's compose file. */
export function compileIncusStack(input: CompileIncusStackInput): StackTarget {
  const { variables } = interpolationSource('managed', {
    dotenv: input.dotenv,
    documents: [input.compose],
  });
  const runtime = [...input.facts.values()].find((facts) =>
    /\/tale-sandbox-runtime@sha256:[a-f0-9]{64}$/.test(facts.reference),
  );
  return requireStackTarget(
    compileStackTarget({
      path: 'managed',
      stack: input.stack,
      documents: [{ compose: input.compose }],
      variables,
      envFiles: { '.env': input.dotenv },
      declaration: input.declaration,
      images: Object.fromEntries(input.facts),
      ...(runtime === undefined
        ? {}
        : {
            sandboxRuntime: {
              reference: runtime.reference,
              digest: runtime.digest,
            },
          }),
      ...(input.egressProxy === undefined
        ? {}
        : { egressProxy: input.egressProxy }),
      architecture: input.platform.split('/')[1] ?? '',
    }),
  );
}

/** The compiled stack as a bundle records it: every environment value
 * removed, so the file carries no secret (design D-39). */
export function preparedIncusStack(target: StackTarget): StackTarget {
  return {
    ...target,
    instances: target.instances.map((instance) => ({
      ...instance,
      config: Object.fromEntries(
        Object.entries(instance.config).map(([key, value]) => [
          key,
          key.startsWith('environment.') ? '' : value,
        ]),
      ),
    })),
  };
}

/** What of a target does not depend on the deployment's variables: what
 * runs where, from which image, with which disks and files. */
function stackShape(target: StackTarget): unknown {
  return {
    stack: target.stack,
    project: target.project,
    pool: target.pool,
    network: target.network,
    images: target.images,
    volumes: target.volumes,
    files: target.files,
    switch: target.switch,
    ingress: target.ingress,
    instances: target.instances.map((instance) => ({
      name: instance.name,
      service: instance.service,
      image: instance.image,
      address: instance.address,
      devices: instance.devices,
      stop: instance.stop,
      dependsOn: instance.dependsOn,
    })),
  };
}

/** Refuse a target that is not the stack the bundle was prepared with. */
export function assertPreparedStack(
  target: StackTarget,
  prepared: Buffer,
): void {
  let recorded: unknown;
  try {
    recorded = JSON.parse(prepared.toString('utf8'));
  } catch {
    recorded = null;
  }
  requireRuntime(
    recorded !== null &&
      typeof recorded === 'object' &&
      stableJson(stackShape(recorded as StackTarget)) ===
        stableJson(stackShape(target)),
    PREPARED_STACK_SENTENCE,
  );
}
