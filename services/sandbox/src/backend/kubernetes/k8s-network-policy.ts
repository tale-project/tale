// The Kubernetes egress fence for session pods — the counterpart of the Docker
// egress container's fail-closed iptables SSRF firewall.
//
// On Docker the runner sits on an `--internal` network and its only outbound
// path is the egress proxy, whose entrypoint REJECTs IMDS + RFC1918 at the IP
// layer. On k8s there is no such per-container firewall: the pod gets HTTP_PROXY
// env (advisory — a process can ignore it) and, on the transparent-egress tier,
// a redsocks OUTPUT redirect (TCP only). Neither blocks a raw connection to the
// cloud metadata endpoint or an in-cluster service. A NetworkPolicy is the CNI
// layer that does — so the spawner SHIPS and APPLIES one instead of leaving it
// to an operator to remember.

import type { V1NetworkPolicy } from '@kubernetes/client-node';

import { apiTimeout, httpStatusCode, type K8sClient } from './k8s-client';

export const SESSION_EGRESS_POLICY_NAME = 'tale-sandbox-session-egress';

/**
 * Default-deny egress for `tale.sandbox/role=session` pods. Allows egress ONLY
 * to:
 *   - DNS (UDP/TCP 53), so names still resolve, and
 *   - the sandbox namespace itself, where the egress proxy + LLM gateway live —
 *     the runner reaches the outside world ONLY through that proxy.
 *
 * Everything else is denied by omission: cloud IMDS (169.254.169.254), node and
 * pod IPs in other namespaces, and the public internet directly. A workload that
 * ignores HTTP_PROXY or bypasses the redsocks redirect can no longer reach the
 * metadata endpoint or the internal network — the Contract-4 guarantee the
 * Docker path already meets.
 */
export function buildSessionEgressNetworkPolicy(
  namespace: string,
): V1NetworkPolicy {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: SESSION_EGRESS_POLICY_NAME,
      namespace,
      labels: { 'tale.sandbox-session': '1' },
    },
    spec: {
      podSelector: { matchLabels: { 'tale.sandbox/role': 'session' } },
      policyTypes: ['Egress'],
      egress: [
        {
          // DNS lives in kube-system (CoreDNS/kube-dns); port 53 to any
          // namespace is the standard, safe DNS allowance.
          to: [{ namespaceSelector: {} }],
          ports: [
            { protocol: 'UDP', port: 53 },
            { protocol: 'TCP', port: 53 },
          ],
        },
        {
          // The egress proxy + LLM gateway, reached WITHIN the sandbox
          // namespace. Every namespace carries the immutable
          // `kubernetes.io/metadata.name` label, so this pins egress to THIS
          // namespace only — not other tenants', not the node.
          to: [
            {
              namespaceSelector: {
                matchLabels: { 'kubernetes.io/metadata.name': namespace },
              },
            },
          ],
        },
      ],
    },
  };
}

/**
 * Ensure the session egress policy exists in the backend's namespace, applied
 * by the spawner at init (create, or replace an existing one so a policy change
 * takes effect on redeploy). Throws when it cannot be applied at all — an egress
 * fence that never landed is a real exposure for untrusted workloads, so the
 * caller fails init loudly rather than serve wide-open. (A NetworkPolicy object
 * is accepted by the apiserver even where the CNI does not ENFORCE it; that
 * residual gap is a cluster-provisioning fact this code can't detect, so init
 * also logs the CNI requirement.)
 */
export async function ensureSessionEgressPolicy(
  client: K8sClient,
): Promise<void> {
  const body = buildSessionEgressNetworkPolicy(client.namespace);
  try {
    await client.networking.createNamespacedNetworkPolicy(
      { namespace: client.namespace, body },
      apiTimeout(),
    );
  } catch (err) {
    if (httpStatusCode(err) === 409) {
      // Already present — replace so an updated policy shape takes effect.
      await client.networking
        .replaceNamespacedNetworkPolicy(
          {
            name: SESSION_EGRESS_POLICY_NAME,
            namespace: client.namespace,
            body,
          },
          apiTimeout(),
        )
        .catch((replaceErr: unknown) => {
          console.warn(
            '[sandbox.k8s] could not update session egress NetworkPolicy (keeping the existing one):',
            replaceErr,
          );
        });
      return;
    }
    throw new Error(
      `could not apply session egress NetworkPolicy in ${client.namespace}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}
