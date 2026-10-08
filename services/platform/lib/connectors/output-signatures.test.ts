// @vitest-environment node

/**
 * Every action of the shipped connector catalog documents its output in a
 * form the analysis reads: the typing layer turns the signature into the
 * shape an automation's references are checked against, and a signature it
 * cannot read silently leaves that action's output unknown.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSignature } from '../engine/core/typing/signature';
import { loadConnectorDefinitions } from './catalog';

const SYSTEM_ROOT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system',
);

describe('connector output signatures', () => {
  const connectors = loadConnectorDefinitions({ root: SYSTEM_ROOT });
  const actions = connectors.flatMap((c) =>
    c.actions.map((a) => ({ type: `${c.name}.${a.name}`, output: a.output })),
  );

  it('covers the whole catalog', () => {
    expect(actions.length).toBeGreaterThan(100);
  });

  it('reads every one of them', () => {
    const unreadable = actions.flatMap(({ type, output }) => {
      const parsed = parseSignature(output);
      return 'error' in parsed
        ? [
            `${type}: ${parsed.error.message} at ${parsed.error.offset} in ${JSON.stringify(output)}`,
          ]
        : [];
    });
    expect(unreadable).toEqual([]);
  });
});
