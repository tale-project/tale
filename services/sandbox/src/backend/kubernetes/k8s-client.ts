// Kubernetes API client + the streaming primitives the KubernetesBackend is
// built on. Every primitive here was validated live against kind under Bun
// (see the Phase-2 spike): exec-tar in/out, log-follow, and exit-code via pod
// status all work with token+CA auth.
//
// AUTH NOTE (Bun): Bun's fetch does NOT apply a kubeconfig's client cert or
// custom CA, so a client-cert cluster (e.g. kind's default kubeconfig) auths
// as system:anonymous. The real in-cluster path uses a ServiceAccount BEARER
// TOKEN (an Authorization header Bun sends fine) + the cluster CA — for Bun to
// trust that CA, the container must set NODE_EXTRA_CA_CERTS to the SA ca.crt
// (/var/run/secrets/kubernetes.io/serviceaccount/ca.crt). Local dev needs a
// token-based kubeconfig, not kind's client-cert one.

import { mkdir } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';

import {
  CoreV1Api,
  Exec,
  KubeConfig,
  Log,
  type V1Status,
} from '@kubernetes/client-node';

export interface K8sClient {
  core: CoreV1Api;
  exec: Exec;
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
    exec: new Exec(kc),
    log: new Log(kc),
    namespace,
  };
}

function exitCodeFromStatus(status: V1Status): number {
  if (status.status === 'Success') return 0;
  const cause = status.details?.causes?.find((c) => c.reason === 'ExitCode');
  return cause?.message ? Number(cause.message) : 1;
}

interface RunExecOpts {
  stdin?: Readable;
  stdout?: Writable;
  onStderr?: (b: Buffer) => void;
}

/**
 * Run a command in a container over the exec websocket. Optionally feed stdin
 * and/or sink stdout. Resolves with the remote command's exit code once the
 * websocket closes.
 */
export function runExec(
  client: K8sClient,
  podName: string,
  container: string,
  command: string[],
  opts: RunExecOpts = {},
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let exitCode = 0;
    const stderrSink = new Writable({
      write(chunk, _enc, cb) {
        opts.onStderr?.(Buffer.from(chunk));
        cb();
      },
    });
    client.exec
      .exec(
        client.namespace,
        podName,
        container,
        command,
        opts.stdout ?? null,
        stderrSink,
        opts.stdin ?? null,
        false,
        (status) => {
          exitCode = exitCodeFromStatus(status);
        },
      )
      .then((ws) => {
        ws.on('close', () => resolve(exitCode));
        ws.on('error', reject);
      })
      .catch(reject);
  });
}

/** Retry a flaky exec op (the websocket can occasionally fail to upgrade). */
export async function withExecRetry<T>(
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

/** tar the local staging dir INTO the pod's /workspace via the holder. */
export async function execTarIn(
  client: K8sClient,
  podName: string,
  container: string,
  localDir: string,
): Promise<void> {
  const code = await withExecRetry('tar-in', () => {
    const tar = Bun.spawn(['tar', '-cf', '-', '-C', localDir, '.'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    // Bun's Subprocess.stdout is a web ReadableStream; bridge it to a node
    // Readable for the exec stdin.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const stdin = Readable.fromWeb(tar.stdout as unknown as ReadableStream);
    return runExec(
      client,
      podName,
      container,
      ['tar', '-xf', '-', '-C', '/workspace'],
      {
        stdin,
      },
    );
  });
  if (code !== 0) {
    throw new Error(`k8s exec tar-in failed (remote tar exit ${code})`);
  }
}

/**
 * tar the pod's `remoteDir` back OUT into the local dir, streamed straight
 * into a local `tar -x` (no full-buffer in memory). Non-fatal on a non-zero
 * remote tar exit (e.g. the dir is missing because the run crashed early) —
 * the caller harvests whatever bytes landed locally.
 */
export async function execTarOut(
  client: K8sClient,
  podName: string,
  container: string,
  remoteDir: string,
  localDir: string,
): Promise<void> {
  await mkdir(localDir, { recursive: true });
  await withExecRetry('tar-out', async () => {
    const untar = Bun.spawn(['tar', '-xf', '-', '-C', localDir], {
      stdin: 'pipe',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const stdout = new Writable({
      write(chunk, _enc, cb) {
        void untar.stdin.write(chunk);
        cb();
      },
    });
    const code = await runExec(
      client,
      podName,
      container,
      ['tar', '-cf', '-', '-C', remoteDir, '.'],
      { stdout },
    );
    await untar.stdin.end();
    await untar.exited;
    if (code !== 0) {
      console.warn(
        `[sandbox.k8s] tar-out remote tar exit ${code} for ${remoteDir} (harvesting partial)`,
      );
    }
  });
}

/** `cat` a file in the pod, capped at `maxBytes`. Used to read the stderr log. */
export async function execReadFile(
  client: K8sClient,
  podName: string,
  container: string,
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      const b = Buffer.from(chunk);
      if (total >= maxBytes) {
        truncated = true;
      } else if (total + b.length <= maxBytes) {
        chunks.push(b);
        total += b.length;
      } else {
        chunks.push(b.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
      }
      cb();
    },
  });
  // Non-fatal: a missing file (run crashed before writing) just yields ''.
  await withExecRetry('cat', () =>
    runExec(client, podName, container, ['cat', path], { stdout }),
  ).catch((err) => {
    console.warn(`[sandbox.k8s] cat ${path} failed:`, err);
  });
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

/**
 * Follow a container's stdout log, forwarding each chunk. Returns the
 * AbortController so the caller can stop following once the runner exits.
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
