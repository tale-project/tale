// Kubernetes API client + the HTTP primitives the exec-free KubernetesBackend
// is built on. There is NO exec websocket here: the Phase-2 spike found
// @kubernetes/client-node's `Exec` (isomorphic-ws) unreliable under Bun
// ("Expected 101" upgrade failures), while `Log.log` / `readNamespacedPodLog`
// use a plain HTTPS `fetch` that is reliable. So the backend uses ONLY
// createNamespacedPod / readNamespacedPodLog / deleteNamespacedPod + presigned-
// URL I/O done inside the Pod — every primitive below is plain HTTP.
//
// AUTH NOTE (Bun): @kubernetes/client-node@1.4.0 routes requests through
// node-fetch v2, which calls https.request() with an https.Agent — NOT Bun's
// native fetch(). Through node:https, skipTLSVerify (→ rejectUnauthorized:
// false on the Agent) and caFile (→ ca Buffer on the Agent) ARE honoured by
// Bun's TLS stack. What is NOT honoured is client-cert auth (cert/key options
// on the Agent): Bun's TLS layer does not support mutual TLS client
// certificates, so a client-cert kubeconfig (e.g. kind's default) auths as
// system:anonymous. Use a ServiceAccount bearer-token kubeconfig instead.
//
// In-cluster CA trust: loadFromCluster() sets caFile to the projected SA
// ca.crt, which is read into the Agent's ca option and works as above. As a
// belt-and-suspenders measure the container should also set NODE_EXTRA_CA_CERTS
// to the same path so that any native fetch() calls (e.g. in harvest) trust
// the apiserver CA without requiring an explicit Agent.

import {
  type ConfigurationOptions,
  CoreV1Api,
  KubeConfig,
  Observable,
} from '@kubernetes/client-node';

export interface K8sClient {
  core: CoreV1Api;
  namespace: string;
}

/** Default per-request budget for control-plane calls (small JSON bodies). */
const K8S_API_TIMEOUT_MS = 10_000;
/** Log reads can ship up to stdoutMaxBytes through the apiserver→kubelet proxy. */
const K8S_LOG_TIMEOUT_MS = 30_000;

/**
 * Per-call options that arm an AbortSignal timeout on the underlying fetch.
 * Without this no API call has ANY timeout: one wedged TCP connection (LB
 * failover, half-open socket) would hang its caller forever — deadlines in the
 * poll loops are only checked BETWEEN awaits. The signal genuinely aborts the
 * socket (the generated transport forwards `request.getSignal()` to fetch).
 * Pass as the second argument to every generated API method.
 */
export function apiTimeout(ms = K8S_API_TIMEOUT_MS): ConfigurationOptions {
  return {
    middleware: [
      {
        pre: (ctx) => {
          ctx.setSignal(AbortSignal.timeout(ms));
          return new Observable(Promise.resolve(ctx));
        },
        post: (rsp) => new Observable(Promise.resolve(rsp)),
      },
    ],
    middlewareMergeStrategy: 'append',
  };
}

/**
 * HTTP status from a @kubernetes/client-node ApiException (numeric `code`).
 * Aborts/timeouts and network errors carry no code → undefined.
 */
export function httpStatusCode(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = err.code;
    return typeof c === 'number' ? c : undefined;
  }
  return undefined;
}

/** Definitive 4xx responses that a retry can never fix. */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 409, 422]);

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

/**
 * Retry a flaky HTTP call (Bun's fetch can transiently throw an AbortError).
 * Definitive 4xx responses (not-found, conflict, …) are thrown immediately —
 * retrying them only delays the caller's own 404/409 handling.
 */
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
      const status = httpStatusCode(err);
      if (status !== undefined && NON_RETRYABLE_STATUS.has(status)) throw err;
      lastErr = err;
      console.warn(
        `[sandbox.k8s] ${label} attempt ${i + 1}/${attempts} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (i < attempts - 1) {
        await new Promise<void>((r) => setTimeout(r, 200 * (i + 1)));
      }
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
  opts: { limitBytes?: number; tailLines?: number } = {},
): Promise<string> {
  return withRetry('read-log', () =>
    client.core.readNamespacedPodLog(
      {
        name: podName,
        namespace: client.namespace,
        container,
        ...(opts.limitBytes !== undefined && { limitBytes: opts.limitBytes }),
        ...(opts.tailLines !== undefined && { tailLines: opts.tailLines }),
      },
      apiTimeout(K8S_LOG_TIMEOUT_MS),
    ),
  );
}
