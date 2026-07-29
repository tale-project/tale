/**
 * Package-policy semantics for the run_code governance page. This decision
 * logic used to be shared with the sandbox runtime gate, which moved out with
 * the retired AI backend; the admin policy tester keeps its own faithful copy
 * so the stored policy can still be authored and probed. When the rebuilt
 * runtime returns, re-unify the two so the tester and the gate can never
 * drift.
 */

/**
 * Extract the base package name from a pip/npm spec for allowlist matching.
 *   `python-pptx==1.0.2` → `python-pptx`
 *   `pypdf>=5.1,<6`     → `pypdf`
 *   `sharp@1.2.3`       → `sharp`
 *   `@scope/pkg@1.2.3`  → `@scope/pkg`
 */
export function packageBaseName(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.length === 0) return '';
  // npm scoped: @scope/name[@version]
  if (trimmed.startsWith('@')) {
    const at = trimmed.indexOf('@', 1);
    return at === -1 ? trimmed : trimmed.slice(0, at);
  }
  // Strip first occurrence of any version delimiter — `@` included, so the
  // unscoped npm `name@version` form matches its policy entry too (pip's
  // PEP 508 `name @ url` form is already split at the space).
  const delim = trimmed.search(/[<>=!~ \t@]/);
  return delim === -1 ? trimmed : trimmed.slice(0, delim);
}

/**
 * The run_code package-policy semantics: matching is on the spec's base name,
 * case-insensitive (pip normalizes names per PEP 503; npm names are lowercase
 * by registry rule), and an explicit deny always wins — even in allowlist
 * mode.
 */
export type PackagePolicyDecision =
  | { allowed: true; reason: 'allowlist_match' | 'denylist_not_matched' }
  | { allowed: false; reason: 'deny_match' | 'allowlist_miss' };

export function evaluatePackageAgainstPolicy(
  spec: string,
  bucket: 'python' | 'node',
  policy: {
    defaultMode: 'allowlist' | 'denylist';
    pythonAllow: string[];
    pythonDeny: string[];
    nodeAllow: string[];
    nodeDeny: string[];
  },
): PackagePolicyDecision {
  const base = packageBaseName(spec).toLowerCase();
  const norm = (list: string[]) => list.map((s) => s.trim().toLowerCase());
  const deny = norm(bucket === 'python' ? policy.pythonDeny : policy.nodeDeny);
  if (deny.includes(base)) return { allowed: false, reason: 'deny_match' };
  if (policy.defaultMode === 'allowlist') {
    const allow = norm(
      bucket === 'python' ? policy.pythonAllow : policy.nodeAllow,
    );
    return allow.includes(base)
      ? { allowed: true, reason: 'allowlist_match' }
      : { allowed: false, reason: 'allowlist_miss' };
  }
  return { allowed: true, reason: 'denylist_not_matched' };
}
