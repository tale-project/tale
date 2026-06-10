// Kubernetes API client + the HTTP primitives the exec-free KubernetesBackend
// is built on. There is NO exec websocket here: the Phase-2 spike found
// @kubernetes/client-node's `Exec` (isomorphic-ws) unreliable under Bun
// ("Expected 101" upgrade failures), while `Log.log` / `readNamespacedPodLog`
// use a plain HTTPS `fetch` that is reliable. So the backend uses ONLY
// createNamespacedPod / readNamespacedPodLog / deleteNamespacedPod + presigned-
// URL I/O done inside the Pod — every primitive below is plain HTTP.
//
// AUTH NOTE (Bun): Bun's fetch does NOT apply a kubeconfig's client cert or
// custom CA, so a client-cert cluster (e.g. kind's default kubeconfig) auths
// as system:anonymous. The real in-cluster path uses a ServiceAccount BEARER
// TOKEN (an Authorization header Bun sends fine) + the cluster CA — for Bun to
// trust that CA, the container must set NODE_EXTRA_CA_CERTS to the SA ca.crt
// (/var/run/secrets/kubernetes.io/serviceaccount/ca.crt). Local dev needs a
// token-based kubeconfig, not kind's client-cert one.

import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';

export interface K8sClient {
  core: CoreV1Api;
  namespace: string;
}

export function makeK8sClient(namespace: string): K8sClient {
  const kc = new KubeConfig();
  const server = process.env.SANDBOX_K8S_SERVER;
  const token = process.env.SANDBOX_K8S_TOKEN;
  if (server && token) {
    // Explicit bearer-token config (dev / Bun-friendly). Bun can't use a
    // client-cert kubeconfig, so point at the apiserver with an SA token; CA
    // trust via SANDBOX_K8S_CAFILE + NODE_EXTRA_CA_CERTS, or skipTLSVerify.
    kc.loadFromOptions({
      clusters: [
        {
          name: 'k',
          server,
          ...(process.env.SANDBOX_K8S_CAFILE
            ? { caFile: process.env.SANDBOX_K8S_CAFILE }
            : { skipTLSVerify: true }),
        },
      ],
      users: [{ name: 'sa', token }],
      contexts: [{ name: 'c', cluster: 'k', user: 'sa' }],
      currentContext: 'c',
    });
  } else {
    try {
      // In-cluster: SA token + ca.crt from the projected volume.
      kc.loadFromCluster();
    } catch (err) {
      console.warn(
        '[sandbox.k8s] loadFromCluster failed; falling back to default kubeconfig:',
        err instanceof Error ? err.message : err,
      );
      kc.loadFromDefault();
    }
  }
  return {
    core: kc.makeApiClient(CoreV1Api),
    namespace,
  };
}

/** Retry a flaky HTTP read (Bun's fetch can transiently throw an AbortError). */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(
        `[sandbox.k8s] ${label} attempt ${i + 1}/${attempts} failed:`,
        err instanceof Error ? err.message : err,
      );
      await new Promise<void>((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * One-shot read of a container's logs (no follow / no websocket — a plain HTTP
 * GET). Used both to poll the runner's stdout for live progress and to read the
 * harvest container's result line. `limitBytes` caps the response from the
 * START (matches our "truncate the tail" stdout policy). Because every read is
 * a discrete request/response, there is no long-lived stream to abort — the
 * whole k8s path is Bun-robust by construction.
 */
export async function readPodLog(
  client: K8sClient,
  podName: string,
  container: string,
  opts: { limitBytes?: number } = {},
): Promise<string> {
  return withRetry('read-log', () =>
    client.core.readNamespacedPodLog({
      name: podName,
      namespace: client.namespace,
      container,
      ...(opts.limitBytes !== undefined && { limitBytes: opts.limitBytes }),
    }),
  );
}
