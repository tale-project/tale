// The one-shot exec-spec builders (buildExecSecret/buildExecSpec/parseExecSpec)
// are gone with the retired one-shot K8s path; only the deterministic
// Secret-name derivation survives (the orphan sweep deletes leaked `*-spec`
// Secrets by name).

import { describe, expect, test } from 'bun:test';

import { secretNameFor } from './exec-spec.ts';

describe('secretNameFor', () => {
  test('is deterministic and DNS-1123-safe', () => {
    const id = 'k74m9zr5b8jcgvx2pqfwsdyhntq3l1a0';
    const a = secretNameFor(id);
    expect(a).toBe(secretNameFor(id));
    expect(a).toMatch(/^tale-sbx-[0-9a-f]{16}-spec$/);
  });
});
