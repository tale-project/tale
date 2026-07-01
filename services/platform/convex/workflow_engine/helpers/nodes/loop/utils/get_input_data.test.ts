import { describe, expect, it } from 'vitest';

import type { LoopNodeConfig } from '../../../../types/nodes';
import type { StepExecutionContext } from '../../../../types/workflow';
import { getInputData } from './get_input_data';

/** getInputData only reads ctx.variables; the rest of the context is not
 *  exercised, so a minimal stub keeps the test focused on item resolution. */
function ctxWith(variables: Record<string, unknown>): StepExecutionContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal test stub
  return { variables } as unknown as StepExecutionContext;
}

describe('getInputData', () => {
  it('resolves a raw template string to its array', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test config
    const config = { items: '{{issues}}' } as unknown as LoopNodeConfig;
    const issues = [{ number: 1 }, { number: 2 }];

    expect(getInputData(ctxWith({ issues }), config)).toEqual(issues);
  });

  it('uses an already-resolved items array as-is, never re-interpreting element text as JEXL', () => {
    // The generic step-config pass (execute_step_handler → replaceVariables)
    // has ALREADY resolved config.items from its `{{…}}` template into this
    // concrete array before the loop node runs. Loop items are routinely
    // user-controlled (e.g. GitHub issue titles/bodies) and legitimately
    // contain mustache-like `{{…}}` — spreads (`{{...opts}}`), ellipses
    // (`{{..}}`), Handlebars/Vue snippets. Re-running replaceVariables over the
    // resolved array would parse those as JEXL and throw
    // `Token . unexpected in expression: ..`, killing the whole loop before a
    // single item is processed. They must pass through verbatim.
    const resolvedItems = [
      { number: 7, title: 'Fix spread call foo({{...opts}})' },
      { number: 8, body: 'see {{..}} and {{ a.b.c }} in the template' },
    ];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test config
    const config = { items: resolvedItems } as unknown as LoopNodeConfig;

    expect(() => getInputData(ctxWith({}), config)).not.toThrow();
    expect(getInputData(ctxWith({}), config)).toEqual(resolvedItems);
  });
});
