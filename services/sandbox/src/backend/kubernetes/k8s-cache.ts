// Per-org dependency-cache PVCs (only used when cfg.k8s.cacheMode === 'pvc').
//
// The docker backend uses per-org named volumes; the K8s analogue is a per-org
// ReadWriteMany PVC mounted into each runtime Pod. RWX is required because the
// same org can have concurrent executions scheduled on different nodes — the
// operator must supply an RWX storage class via SANDBOX_K8S_CACHE_STORAGECLASS.
// Default cacheMode 'none' skips all of this (installs run fresh via the proxy).

import { createHash } from 'node:crypto';

import type { SpawnerConfig } from '../../types.ts';
import type { CacheStores } from '../types.ts';
import type { K8sClient } from './k8s-client.ts';

function pvcName(prefix: string, organizationId: string): string {
  // DNS-1123 name: org ids may carry uppercase/underscore, so hash them.
  const slug = createHash('sha1')
    .update(organizationId)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${slug}`;
}

export function cacheStoreNames(
  cfg: SpawnerConfig,
  organizationId: string,
): CacheStores {
  return {
    pip: pvcName(cfg.cacheVolumePrefix.pip, organizationId),
    npm: pvcName(cfg.cacheVolumePrefix.npm, organizationId),
  };
}

/** Idempotently create a per-org RWX PVC; tolerates "already exists". */
async function ensurePvc(client: K8sClient, name: string): Promise<void> {
  try {
    await client.core.readNamespacedPersistentVolumeClaim({
      name,
      namespace: client.namespace,
    });
    return; // already exists
  } catch {
    // Not found (or transient) — fall through to create.
  }
  const storageClassName = process.env.SANDBOX_K8S_CACHE_STORAGECLASS;
  try {
    await client.core.createNamespacedPersistentVolumeClaim({
      namespace: client.namespace,
      body: {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name, labels: { 'tale.sandbox-cache': '1' } },
        spec: {
          accessModes: ['ReadWriteMany'],
          ...(storageClassName ? { storageClassName } : {}),
          resources: { requests: { storage: '2Gi' } },
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) return;
    throw new Error(`k8s cache: failed to create PVC ${name}: ${msg}`, {
      cause: err,
    });
  }
}

export async function ensureCachePvcs(
  client: K8sClient,
  cfg: SpawnerConfig,
  organizationId: string,
): Promise<CacheStores> {
  const names = cacheStoreNames(cfg, organizationId);
  await ensurePvc(client, names.pip);
  await ensurePvc(client, names.npm);
  return names;
}
