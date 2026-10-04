// A separate process is required: Node reads extra CA roots only at launch.
import assert from 'node:assert/strict';

import { browserOrigins } from './origins.mjs';
const [origin, expected] = process.argv.slice(2);
assert(browserOrigins.includes(origin), 'Unowned TLS proof origin');
assert(['trusted', 'untrusted'].includes(expected));
try {
  const response = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert(response.ok, 'Production health failed');
  assert.equal(
    expected,
    'trusted',
    'An untrusted TLS client accepted the synthetic certificate',
  );
  console.log(
    JSON.stringify({
      expected,
      verified: true,
      origin,
      runtime: process.versions.bun
        ? `Bun${process.versions.bun}`
        : `Node${process.versions.node}`,
    }),
  );
} catch (error) {
  if (expected !== 'untrusted') throw error;
  const code = error?.cause?.code ?? error?.code;
  assert(
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'CERT_UNTRUSTED',
    ].includes(code),
    `Untrusted client failed for a non-certificate reason: ${code}`,
  );
  console.log(
    JSON.stringify({
      expected,
      verified: false,
      certificateRefused: true,
      code,
      origin,
      runtime: process.versions.bun
        ? `Bun${process.versions.bun}`
        : `Node${process.versions.node}`,
    }),
  );
}
