// Kubernetes API client + the HTTP primitives the exec-free KubernetesBackend
// is built on. There is NO exec websocket here: the Phase-2 spike found
// @kubernetes/client-node's `Exec` (isomorphic-ws) unreliable under Bun
// ("Expected 101" upgrade failures), while `Log.log` / `readNamespacedPodLog`
// use a plain HTTPS `fetch` that is reliable. So the backend uses ONLY
// createNamespacedPod / readNamespacedPodLog / deleteNamespacedPod + presigned-
// URL I/O done inside the Pod — every primitive below is plain HTTP.
//
// TLS NOTE (Bun + @kubernetes/client-node@1.4.0): The library sends HTTP via
// node-fetch@2, which uses node:https.request with an https.Agent carrying the
// kubeconfig TLS options.  Empirical testing (Bun 1.3.14) confirms that Bun's
// node:https shim does NOT apply the agent's `ca` or `rejectUnauthorized`
// fields — they are stored on the Agent object but silently ignored at the TLS
// layer.  Concrete consequences:
//
//   • caFile / caData in the kubeconfig  → INERT; custom CA is NOT loaded.
//     Real CA trust requires NODE_EXTRA_CA_CERTS (e.g. pointed at the SA
//     ca.crt: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt).
//
//   • skipTLSVerify: true in the kubeconfig → INERT; TLS is still verified.
//     It looks like a security bypass but does nothing — do not rely on it.
//
//   • Client certificates (cert/key) in the kubeconfig → INERT; the cluster
//     treats the request as system:anonymous.
//
// The real in-cluster path works because it uses a ServiceAccount bearer token
// (an Authorization header Bun sends correctly) and sets NODE_EXTRA_CA_CERTS
// to the SA ca.crt so Bun trusts the apiserver's TLS certificate.  Local dev
// must use a token-based kubeconfig, not kind's default client-cert kubeconfig.

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
    // client-cert kubeconfig, so point at the apiserver with an SA token.
    // CA trust: set NODE_EXTRA_CA_CERTS to the cluster CA file — caFile here
    // is inert under Bun (see TLS NOTE above) but is kept for documentation
    // of intent and compatibility with non-Bun runtimes.
    // skipTLSVerify is intentionally absent: it is also inert under Bun and
    // looks like a security bypass without providing one.
    kc.loadFromOptions({
      clusters: [
        {
          name: 'k',
          server,
          ...(process.env.SANDBOX_K8S_CAFILE && {
            caFile: process.env.SANDBOX_K8S_CAFILE,
          }),
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
