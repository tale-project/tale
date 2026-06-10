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

import { Writable } from 'node:stream';

import { CoreV1Api, KubeConfig, Log } from '@kubernetes/client-node';

export interface K8sClient {
  core: CoreV1Api;
  log: Log;
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
    log: new Log(kc),
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
 * Follow a container's stdout log, forwarding each chunk. Returns the
 * AbortController so the caller can stop following once the container exits.
 * (The K8s log API merges stdout+stderr; the runner redirects its stderr to a
 * file so this stream is stdout-only — see k8s-pod-spec.ts.)
 */
export function followLogs(
  client: K8sClient,
  podName: string,
  container: string,
  onChunk: (b: Buffer) => void,
): Promise<AbortController> {
  const sink = new Writable({
    write(chunk, _enc, cb) {
      onChunk(Buffer.from(chunk));
      cb();
    },
  });
  // Use the done-callback overload so the stream-termination error is handled
  // HERE rather than left as a detached/unhandled rejection. Aborting the
  // controller on stop rejects the underlying fetch with AbortError under Bun
  // — that's expected; only genuine errors are worth logging. (An unhandled
  // AbortError would otherwise crash the spawner process.)
  return client.log.log(
    client.namespace,
    podName,
    container,
    sink,
    (err: unknown) => {
      if (err && !(err instanceof Error && err.name === 'AbortError')) {
        console.warn('[sandbox.k8s] log stream ended with error:', err);
      }
    },
    { follow: true },
  );
}

/**
 * One-shot read of a container's full logs (no follow). Used to read the
 * harvest container's result line after it has terminated. Plain HTTP GET.
 */
export async function readPodLog(
  client: K8sClient,
  podName: string,
  container: string,
): Promise<string> {
  return withRetry('read-log', () =>
    client.core.readNamespacedPodLog({
      name: podName,
      namespace: client.namespace,
      container,
    }),
  );
}
