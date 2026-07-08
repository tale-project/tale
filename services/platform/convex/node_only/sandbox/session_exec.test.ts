// Inline-snippet staging contract: the synthesized path routes the right
// interpreter (extension-dispatched by interpreterCommand) and stays inside
// the hidden .inline dir, which is never a threadFile and thus invisible to
// sandboxState. Pure function — no mocks.

import { describe, expect, it } from 'vitest';

import { inlineStagePath, stagePathOf } from './session_exec';

describe('inlineStagePath', () => {
  it('routes each language to the extension the runtime dispatches on', () => {
    expect(inlineStagePath('python', 'abc')).toBe('code/.inline/run-abc.py');
    expect(inlineStagePath('node', 'abc')).toBe('code/.inline/run-abc.mjs');
    expect(inlineStagePath('bash', 'abc')).toBe('code/.inline/run-abc.sh');
  });

  it('stages under the hidden code/.inline/ dir, unique per run id', () => {
    const a = inlineStagePath('bash', 'id-a');
    const b = inlineStagePath('bash', 'id-b');
    expect(a.startsWith('code/.inline/')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('round-trips through stagePathOf like every other step path', () => {
    const rel = inlineStagePath('python', 'x');
    expect(stagePathOf(`/user/${rel}`)).toBe(rel);
  });
});
