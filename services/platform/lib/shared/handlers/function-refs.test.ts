import { getFunctionName, anyApi, componentsGeneric } from 'convex/server';
import { describe, expect, it } from 'vitest';

import {
  createComponentRefs,
  createFunctionRefs,
  functionRefName,
} from './function-refs';

/**
 * The ctx shim's handler tables are keyed by the strings the RETIRED runtime's
 * namer produced. This suite is the proof that ours produces the same ones —
 * run against the package itself, while it is still installed, over every name
 * the reused tree actually uses plus the shapes that are easy to get wrong
 * (a `default` export, a nested module path, a component reference).
 *
 * When `convex` finally leaves `package.json`, the comparison goes and the
 * table of expected strings stays: the format is ours to keep either way.
 */

// oxlint-disable-next-line typescript/no-explicit-any -- both sides are proxies; the test is about the strings they yield
type Refs = any;

const ours: Refs = createFunctionRefs();
const theirs: Refs = anyApi;

const PATHS: readonly string[][] = [
  ['tasks', 'helpers', 'recordActivity'],
  ['audit_logs', 'internal_mutations', 'createAuditLog'],
  ['node_only', 'sandbox', 'session_exec', 'runExec'],
  ['chat', 'messages', 'appendMessageInternal'],
  ['lib', 'config_store', 'actions', 'readConfigArea'],
  ['enterprise_sso', 'login', 'callback_handler', 'default'],
  ['provisioning', 'default'],
];

function walk(root: Refs, path: readonly string[]): Refs {
  return path.reduce<Refs>((node, part) => node[part], root);
}

describe('functionRefName matches the retired runtime', () => {
  it.each(PATHS.map((p) => [p.join('.'), p] as const))(
    'names %s the same way',
    (_label, path) => {
      expect(functionRefName(walk(ours, path))).toBe(
        getFunctionName(walk(theirs, path)),
      );
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
  it('matches what the retired runtime addressed the adapter by', () => {
    const oursRef: Refs = createComponentRefs();
    const theirsRef: Refs = componentsGeneric();
    const path = ['betterAuth', 'adapter', 'findOne'] as const;
    // The runtime's `getFunctionName` REFUSES a component reference (it has no
    // name, only an address), which is why the shim reads the address itself.
    expect(() => getFunctionName(walk(theirsRef, path))).toThrow();
    expect(functionRefName(walk(oursRef, path))).toBe(
      '_reference/childComponent/betterAuth/adapter/findOne',
    );
  });
});
