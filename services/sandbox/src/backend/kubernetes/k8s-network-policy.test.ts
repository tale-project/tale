// The k8s egress fence shape — the counterpart of the Docker egress firewall.
// Pins that session pods may egress ONLY to DNS + their own namespace (the
// proxy + gateway), so cloud IMDS, the node, and other namespaces are denied.

import { describe, expect, test } from 'bun:test';

import {
  buildSessionEgressNetworkPolicy,
  SESSION_EGRESS_POLICY_NAME,
} from './k8s-network-policy.ts';

describe('buildSessionEgressNetworkPolicy', () => {
  const policy = buildSessionEgressNetworkPolicy('tale-sandbox');

  test('selects only session pods and governs egress', () => {
    expect(policy.metadata?.name).toBe(SESSION_EGRESS_POLICY_NAME);
    expect(policy.metadata?.namespace).toBe('tale-sandbox');
    expect(policy.spec?.podSelector?.matchLabels).toEqual({
      'tale.sandbox/role': 'session',
    });
    expect(policy.spec?.policyTypes).toEqual(['Egress']);
  });

  test('allows DNS on port 53 (udp + tcp)', () => {
    const dns = policy.spec?.egress?.find((rule) =>
      rule.ports?.some((p) => p.port === 53),
    );
    expect(dns).toBeDefined();
    const protocols = dns?.ports?.map((p) => p.protocol).sort();
    expect(protocols).toEqual(['TCP', 'UDP']);
  });

  test('allows egress only to its own namespace (the proxy + gateway)', () => {
    const nsRule = policy.spec?.egress?.find(
      (rule) =>
        rule.ports === undefined &&
        rule.to?.some(
          (peer) =>
            peer.namespaceSelector?.matchLabels?.[
              'kubernetes.io/metadata.name'
            ] === 'tale-sandbox',
        ),
    );
    expect(nsRule).toBeDefined();
  });

  test('denies everything else — no 0.0.0.0/0 or IMDS allowance', () => {
    // Default-deny by omission: the only egress rules are DNS + same-namespace.
    // No ipBlock rule exists, so the public internet, the node, cloud IMDS
    // (169.254.169.254), and other namespaces are all unreachable.
    const hasIpBlock = policy.spec?.egress?.some((rule) =>
      rule.to?.some((peer) => peer.ipBlock !== undefined),
    );
    expect(hasIpBlock).toBeFalsy();
    expect(policy.spec?.egress).toHaveLength(2);
  });
});
