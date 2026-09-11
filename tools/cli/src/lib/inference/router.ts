import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify } from 'yaml';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256, valueHash } from '../config/releases/identity';
import { sha, slug } from '../config/releases/model';
import { admissionPolicy, INFERENCE_ADMISSION_SHA } from './admission';
import { inferenceBundleHash, type InferenceBundle } from './bundle';
import { writePublicArtifact } from './files';
import {
  modelIdentity,
  OMLX_RUNTIME,
  ROUTER_API_PORT,
  inferenceModelSchema,
  type InferenceModel,
  type InferenceSpec,
} from './model';

export const INFERENCE_CADDY_IMAGE =
  'caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648';
export const INFERENCE_ZEROTIER_IMAGE =
  'zyclonite/zerotier:1.16.2@sha256:36fccb1e9e4e8f9bf50eeb7ecc0aaec0db3679c82d15b554e0540581609af99b';
export const routerTopologySchema = z.strictObject({
  schemaVersion: z.literal(1),
  backendNetwork: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  overlayNetwork: z.strictObject({
    env: z.string().regex(/^TALE_[A-Z0-9_]{1,120}$/),
  }),
});
export type RouterTopology = z.infer<typeof routerTopologySchema>;
const proofSchema = z.strictObject({
  ready: z.literal(true),
  unchanged: z.boolean(),
  bundleSha256: sha,
  release: sha,
  organization: slug,
  node: slug,
  address: z.string(),
  port: z.number().int(),
  runtimeVersion: z.literal(OMLX_RUNTIME.version),
  runtimeSha256: z.literal(OMLX_RUNTIME.sha256),
  models: z
    .array(
      z.strictObject({
        key: slug,
        apiModel: z.string(),
        identity: sha,
        capability: z.enum(['text', 'vision', 'embedding']),
        configurationProjection:
          inferenceModelSchema.shape.configurationProjection
            .unwrap()
            .nullable(),
      }),
    )
    .max(32),
  observedAt: z.string().datetime(),
  performanceMeasured: z.literal(true),
  capabilitiesVerified: z.literal(true),
  boundedBenchmarkVerified: z.literal(true),
  sustainedLoadMeasured: z.literal(false),
  admission: z.strictObject({
    adapterSha256: z.literal(INFERENCE_ADMISSION_SHA),
    policySha256: sha,
    residency: z.literal('evictable-on-demand'),
    maximumConcurrency: z.literal(1),
    loadedRoles: z.array(slug).max(32),
  }),
});
export type InferenceReadyProof = z.infer<typeof proofSchema>;

/** Fixed metadata for native discovery; declared source identity and actual
 * readiness are checked separately by each proxy route. */
export function inferenceModelCatalog(model: InferenceModel) {
  return {
    data: [
      {
        id: model.apiModel,
        context_window: model.contextTokens,
        modalities: {
          input: model.capability === 'vision' ? ['text', 'image'] : ['text'],
          output: model.capability === 'embedding' ? ['embeddings'] : ['text'],
        },
        supported_parameters:
          model.capability === 'text' ? ['tools', 'tool_choice'] : [],
      },
    ],
  };
}

/** These are operator-transferred status receipts, not remote attestation.
 * The selected receipt SHA is part of the reviewed topology. Caddy additionally
 * checks each live node's exact admission policy, never just TCP liveness.
 * Loaded roles remain a separate observed fact; cold models stay routable. */
export function admittedProofs(
  spec: InferenceSpec,
  input: unknown[],
  now = Date.now(),
  expectedBundleHash = inferenceBundleHash(spec),
): InferenceReadyProof[] {
  const proofs = input.map((raw) => {
    const parsed = proofSchema.safeParse(raw);
    if (!parsed.success)
      throw preconditionError('Inference router status proof is invalid.');
    const proof = parsed.data;
    const node = spec.nodes.find((candidate) => candidate.key === proof.node);
    const age = now - Date.parse(proof.observedAt);
    if (
      !node ||
      proof.bundleSha256 !== expectedBundleHash ||
      proof.organization !== spec.organization ||
      proof.address !== node.address ||
      proof.port !== node.port ||
      age < -60_000 ||
      age > 600_000
    )
      throw preconditionError(
        'Inference router proof is stale or belongs to another node, organization or bundle.',
      );
    const expected = spec.models
      .filter((model) => node.models.includes(model.key))
      .map((model) => ({
        key: model.key,
        apiModel: model.apiModel,
        identity: modelIdentity(model),
        capability: model.capability,
        configurationProjection: model.configurationProjection ?? null,
      }));
    if (
      valueHash(proof.models) !== valueHash(expected) ||
      proof.admission.policySha256 !==
        admissionPolicy(spec, node).policySha256 ||
      new Set(proof.admission.loadedRoles).size !==
        proof.admission.loadedRoles.length ||
      proof.admission.loadedRoles.some((role) => !node.models.includes(role))
    )
      throw preconditionError(
        'Inference router proof has different model bytes or capabilities.',
      );
    return proof;
  });
  if (new Set(proofs.map((proof) => proof.node)).size !== proofs.length)
    throw preconditionError('Inference router contains duplicate node proofs.');
  return proofs;
}

export function inferenceCaddyfile(
  spec: InferenceSpec,
  proofs: InferenceReadyProof[],
  port = ROUTER_API_PORT,
): string {
  const lines = [
    '{',
    '  admin off',
    '  auto_https off',
    '}',
    `:${port} {`,
    '  @unauthorized {',
    `    not header Authorization "Bearer {$${spec.serviceKey.env}}"`,
    '    not {',
    `      path ${spec.models.map((model) => `/${spec.organization}/${model.key}/v1/models`).join(' ')}`,
    '      method GET',
    '    }',
    '  }',
    '  respond @unauthorized "Unauthorized" 401',
  ];
  for (const [index, model] of spec.models.entries()) {
    const prefix = `/${spec.organization}/${model.key}`;
    // Native catalog discovery deliberately sends no credentials. Only this
    // fixed metadata is readable on the internal bridge; compute stays keyed.
    const catalog = JSON.stringify(inferenceModelCatalog(model));
    lines.push(
      `  @catalog${index} {`,
      `    path ${prefix}/v1/models`,
      '    method GET',
      '  }',
      `  handle @catalog${index} {`,
      '    header Content-Type application/json',
      `    respond ${JSON.stringify(catalog)} 200`,
      '  }',
    );
    const nodes = spec.nodes.filter(
      (node) =>
        node.models.includes(model.key) &&
        proofs.some((proof) => proof.node === node.key),
    );
    const endpoints =
      model.capability === 'embedding' ? ['embeddings'] : ['chat/completions'];
    lines.push(
      `  @model${index} {`,
      `    path ${endpoints.map((endpoint) => `${prefix}/v1/${endpoint}`).join(' ')}`,
      '    method POST',
      '  }',
      `  handle @model${index} {`,
    );
    if (!nodes.length)
      lines.push(
        '    header Retry-After 10',
        '    respond "The selected model has no admitted ready replica." 503',
      );
    else
      lines.push(
        `    uri strip_prefix ${prefix}`,
        '    request_body {',
        '      max_size 32MB',
        '    }',
        `    reverse_proxy ${nodes.map((node) => `${node.address}:${node.port}`).join(' ')} {`,
        '      lb_policy header X-Tale-Cache-Affinity {',
        '        fallback first',
        '      }',
        '      lb_retries 0',
        '      lb_try_duration 0s',
        '      health_uri /_tale/admission',
        '      health_interval 5s',
        '      health_timeout 3s',
        '      health_passes 1',
        '      health_fails 1',
        // Each exact policy binds the complete role inventory and native gate.
        // A cold model remains routable; no loaded/warm claim is inferred.
        '      health_body `"policySha256"\\s*:\\s*"(' +
          nodes
            .map((node) => admissionPolicy(spec, node).policySha256)
            .join('|') +
          ')"`',
        '      health_headers {',
        `        Authorization "Bearer {$${spec.serviceKey.env}}"`,
        '      }',
        '      fail_duration 10s',
        '      max_fails 1',
        '      unhealthy_status 5xx',
        `      unhealthy_request_count ${spec.limits.concurrency + spec.limits.queuedRequests}`,
        '      transport http {',
        '        versions 1.1',
        '        dial_timeout 3s',
        `        response_header_timeout ${spec.limits.queueTimeoutSeconds + spec.limits.requestTimeoutSeconds + 10}s`,
        '      }',
        '    }',
      );
    lines.push('  }');
  }
  lines.push(
    '  respond "Unknown inference route or method." 404',
    '  handle_errors {',
    '    header Retry-After 10',
    '    respond "Inference replica unavailable or busy; no request was retried." 503',
    '  }',
    '}',
  );
  return lines.join('\n') + '\n';
}

export function inferenceRouterCompose(
  spec: InferenceSpec,
  topology: RouterTopology,
  proofs: InferenceReadyProof[] = [],
) {
  const required = (name: string) =>
    '${' + name + ':?required inference environment}';
  return {
    services: {
      'inference-overlay': {
        image: INFERENCE_ZEROTIER_IMAGE,
        restart: 'unless-stopped',
        cap_add: ['NET_ADMIN'],
        devices: ['/dev/net/tun:/dev/net/tun'],
        environment: {
          ZT_NETWORKS: required(topology.overlayNetwork.env),
          ZT_OVERRIDE_LOCAL_CONF: 'true',
          ZT_ALLOW_MANAGEMENT_FROM: '',
          ZT_PORT_MAPPING_ENABLED: 'false',
        },
        volumes: ['inference-overlay-identity:/var/lib/zerotier-one'],
        networks: {
          'inference-backend': { aliases: ['inference-overlay.local'] },
        },
      },
      'inference-router': {
        image: INFERENCE_CADDY_IMAGE,
        labels: {
          'dev.tale.inference.policy-sha256': sha256(
            inferenceCaddyfile(spec, proofs),
          ),
        },
        restart: 'unless-stopped',
        network_mode: 'service:inference-overlay',
        depends_on: ['inference-overlay'],
        read_only: true,
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        environment: { [spec.serviceKey.env]: required(spec.serviceKey.env) },
        volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro'],
        tmpfs: ['/data', '/config'],
        command: [
          'caddy',
          'run',
          '--config',
          '/etc/caddy/Caddyfile',
          '--adapter',
          'caddyfile',
        ],
      },
    },
    volumes: { 'inference-overlay-identity': {} },
    networks: {
      'inference-backend': { external: true, name: topology.backendNetwork },
    },
  };
}

export async function writeInferenceRouter(
  directory: string,
  bundle: InferenceBundle,
  topologyInput: unknown,
  proofInput: unknown[] = [],
  now = Date.now(),
) {
  const topology = routerTopologySchema.parse(topologyInput);
  const proofs = admittedProofs(
    bundle.spec,
    proofInput,
    now,
    bundle.bundleSha256,
  );
  if (bundle.spec.mode !== 'replicas')
    throw preconditionError(
      'The inference router only admits independent replicas; experimental sharding is not production-ready.',
    );
  try {
    await mkdir(directory, { mode: 0o755 });
  } catch {
    throw preconditionError(
      'Inference router output already exists or cannot be created. Choose a new directory.',
    );
  }
  const caddyfile = inferenceCaddyfile(bundle.spec, proofs);
  const compose = inferenceRouterCompose(bundle.spec, topology, proofs);
  const metadata = {
    schemaVersion: 1,
    bundleSha256: bundle.bundleSha256,
    topology,
    admittedNodes: proofs.map((proof) => proof.node),
    proofSha256: proofs.map(valueHash),
    modelRoutes: bundle.spec.models.map((model) => ({
      model: model.apiModel,
      capability: model.capability,
      providerBaseUrl: `http://inference-overlay.local:${ROUTER_API_PORT}/${bundle.spec.organization}/${model.key}/v1`,
    })),
    caddySha256: sha256(caddyfile),
    composeSha256: sha256(stringify(compose)),
    ready: bundle.spec.models.every((model) =>
      proofs.some((proof) =>
        proof.models.some((entry) => entry.key === model.key),
      ),
    ),
    streamingRetries: 0,
    affinity: 'X-Tale-Cache-Affinity, otherwise fixed first admitted replica',
    admission: 'one bounded native FIFO per Mac across all roles',
    residency: 'evictable-on-demand; cold-switch latency is measured on target',
    crossHostAttestation: false,
  };
  await writePublicArtifact(join(directory, 'Caddyfile'), caddyfile);
  await writePublicArtifact(join(directory, 'compose.yml'), stringify(compose));
  await writePublicArtifact(
    join(directory, 'router.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );
  return metadata;
}
