// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { freezeScopes, makeScope } from './scope';

/**
 * A scope is a view of what a run holds, never a copy: building one costs
 * nothing however large the outputs before a node are. The suites hand out
 * frozen copies instead (`tests/setup-server.ts`), so a write to a scope
 * anywhere in the engine throws.
 */

afterEach(() => {
  freezeScopes(true);
});

describe('makeScope', () => {
  it("hands out a view of the run's own values", () => {
    freezeScopes(false);
    const input = { owner: 'tale' };
    const outputs = { fetch: { output: { rows: [1, 2] } } };
    const scope = makeScope(input, outputs, { item: 'a', index: 0 });
    expect(scope.input).toBe(input);
    expect(scope.nodes).toBe(outputs);
    expect(scope).toMatchObject({ item: 'a', index: 0 });
  });

  it('in a suite, hands out a frozen copy that refuses a write', () => {
    const outputs = { fetch: { output: { rows: [1, 2] } } };
    const scope = makeScope({ owner: 'tale' }, outputs);
    expect(scope.nodes).not.toBe(outputs);
    expect(scope.nodes).toEqual(outputs);
    expect(Object.isFrozen(scope.nodes)).toBe(true);
    expect(Object.isFrozen(scope.nodes.fetch?.output)).toBe(true);
    expect(Reflect.set(scope.nodes, 'other', { output: 1 })).toBe(false);
  });
});
