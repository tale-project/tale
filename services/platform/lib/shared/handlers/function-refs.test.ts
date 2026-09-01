import { describe, expect, it } from 'vitest';

import {
  createComponentRefs,
  createFunctionRefs,
  functionRefName,
} from './function-refs';

/**
 * The ctx shim's handler tables are keyed by the strings the RETIRED runtime's
 * namer produced. While the `convex` package was still installed, this suite
 * compared our namer against the package's over every shape below; the package
 * is gone, the comparison went with it, and the expected strings stay — the
 * format is ours to keep.
 */

// oxlint-disable-next-line typescript/no-explicit-any -- a recording proxy; the test is about the strings it yields
type Refs = any;

const ours: Refs = createFunctionRefs();

const CASES: readonly (readonly [readonly string[], string])[] = [
  [['tasks', 'helpers', 'recordActivity'], 'tasks/helpers:recordActivity'],
  [
    ['audit_logs', 'internal_mutations', 'createAuditLog'],
    'audit_logs/internal_mutations:createAuditLog',
  ],
  [
    ['node_only', 'sandbox', 'session_exec', 'runExec'],
    'node_only/sandbox/session_exec:runExec',
  ],
  [
    ['chat', 'messages', 'appendMessageInternal'],
    'chat/messages:appendMessageInternal',
  ],
  [
    ['lib', 'config_store', 'actions', 'readConfigArea'],
    'lib/config_store/actions:readConfigArea',
  ],
  // A `default` export keeps only the module path.
  [
    ['enterprise_sso', 'login', 'callback_handler', 'default'],
    'enterprise_sso/login/callback_handler',
  ],
  [['provisioning', 'default'], 'provisioning'],
];

function walk(root: Refs, path: readonly string[]): Refs {
  return path.reduce<Refs>((node, part) => node[part], root);
}

describe('functionRefName matches the retired runtime', () => {
  it.each(CASES.map(([p, expected]) => [p.join('.'), p, expected] as const))(
    'names %s the same way',
    (_label, path, expected) => {
      expect(functionRefName(walk(ours, path))).toBe(expected);
    },
  );

  it('drops a `default` export from the name, keeping the module path', () => {
    expect(functionRefName(ours.audit_logs.emit.default)).toBe(
      'audit_logs/emit',
    );
  });

  it('joins every segment but the last with slashes', () => {
    expect(functionRefName(ours.a.b.c.d)).toBe('a/b/c:d');
  });

  it('refuses a path that names no export', () => {
    expect(() => functionRefName(ours.solo)).toThrow(/api\.module\.export/);
  });

  it('passes a bare name straight through', () => {
    expect(functionRefName('tasks/helpers:recordActivity')).toBe(
      'tasks/helpers:recordActivity',
    );
  });

  it('refuses something that is not a reference at all', () => {
    expect(() => functionRefName({ nope: true })).toThrow(
      /Not a function reference/,
    );
  });
});

describe('component references keep their raw path', () => {
  it('addresses the adapter the way the retired runtime did', () => {
    const oursRef: Refs = createComponentRefs();
    // The retired runtime's `getFunctionName` REFUSED a component reference
    // (it has no name, only an address), which is why the shim reads the
    // address itself.
    expect(
      functionRefName(walk(oursRef, ['betterAuth', 'adapter', 'findOne'])),
    ).toBe('_reference/childComponent/betterAuth/adapter/findOne');
  });
});
