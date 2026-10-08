/**
 * The names an automation expression may use without declaring them: the
 * scope the engine hands each field, plus the JavaScript global object.
 */

import type { NodeDef } from '../types';

/**
 * The ES2024 global object as every runner context provides it, plus
 * `console` (present in V8 contexts). A free name outside this set and
 * outside the field's scope names is a ReferenceError at run time.
 */
export const ES_GLOBALS: ReadonlySet<string> = new Set([
  'globalThis',
  'undefined',
  'NaN',
  'Infinity',
  'Object',
  'Function',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'Promise',
  'Reflect',
  'Proxy',
  'Intl',
  'Atomics',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'console',
]);

/** The fields of a node (and the document output) that hold expressions. */
export type SourceField =
  | 'input'
  | 'prompt'
  | 'system'
  | 'files'
  | 'code'
  | 'forEach'
  | 'when'
  | 'repeatUntil'
  | 'output';

/**
 * The scope names an expression in `field` sees at run time.
 *
 * Templates and the document output see `input` and `nodes`; an iterating
 * node adds `item` and `index` — except in `forEach` itself and in `when`,
 * which are evaluated once, before the items are. `repeatUntil` also sees
 * the pass's `output`. Transform code always declares `input`, `nodes`,
 * `item` and `index` (the last two are undefined outside forEach).
 */
export function scopeNamesFor(
  field: SourceField,
  node?: Pick<NodeDef, 'forEach'>,
): ReadonlySet<string> {
  const names = new Set(['input', 'nodes']);
  if (field === 'code') return new Set([...names, 'item', 'index']);
  const iterates = typeof node?.forEach === 'string';
  if (iterates && field !== 'forEach' && field !== 'when') {
    names.add('item');
    names.add('index');
  }
  if (field === 'repeatUntil') names.add('output');
  return names;
}
