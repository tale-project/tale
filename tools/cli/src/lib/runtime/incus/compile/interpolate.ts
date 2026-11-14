import { RefusalError, refusal } from './refusals';

/**
 * Docker Compose's variable interpolation and its `.env` grammar, done by the
 * CLI itself: Incus reads no compose file, so the runtime must hand every
 * instance the values Docker Compose would have handed its container.
 *
 * - Templates: `$$` (a literal `$`), `$V`, `${V}`, `${V:-default}`,
 *   `${V-default}`, `${V:?error}` and `${V?error}`, nested in a default or an
 *   error. Any other operator (`${V:+x}`, `${V/x/y}`, …) is refused rather
 *   than read differently from Compose. A `$` before anything else stays a
 *   literal `$`, as in Compose.
 * - `.env`: Compose's dotenv grammar (compose-go `dotenv`), not the
 *   simplified reader of `utils/load-env.ts`: `export`, `KEY: value`, single
 *   quotes (literal), double quotes (escapes and interpolation), inline
 *   comments after ` #`, and a bare `KEY`, which takes the value of the
 *   environment.
 *
 * `interpolate-oracle.test.ts` holds both to `docker compose config`.
 */

export type Lookup = (name: string) => string | undefined;

const NAME = /^[_a-zA-Z][_a-zA-Z0-9]*$/;
const NAME_START = /[_a-zA-Z]/;
const NAME_PART = /[_a-zA-Z0-9]/;

/** The variable names `text` references, operators and nesting included. */
export function referencedNames(
  text: string,
  into = new Set<string>(),
): Set<string> {
  try {
    substitute(
      text,
      (name) => {
        into.add(name);
        return undefined;
      },
      { collect: true },
    );
  } catch (error) {
    // A malformed template references nothing more; compiling it refuses it.
    if (!(error instanceof RefusalError)) throw error;
  }
  return into;
}

/** Interpolate one string as Docker Compose does. */
export function interpolate(text: string, lookup: Lookup): string {
  return substitute(text, lookup, { collect: false });
}

function substitute(
  text: string,
  lookup: Lookup,
  options: { collect: boolean },
): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const dollar = text.indexOf('$', index);
    if (dollar === -1) {
      out += text.slice(index);
      break;
    }
    out += text.slice(index, dollar);
    const next = text[dollar + 1];
    if (next === '$') {
      out += '$';
      index = dollar + 2;
      continue;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let end = dollar + 2;
      while (end < text.length && NAME_PART.test(text[end] ?? '')) end += 1;
      out += lookup(text.slice(dollar + 1, end)) ?? '';
      index = end;
      continue;
    }
    if (next !== '{') {
      // Compose leaves a `$` it cannot read as a reference in place.
      out += '$';
      index = dollar + 1;
      continue;
    }
    const close = closingBrace(text, dollar + 2);
    if (close === -1)
      throw new RefusalError(
        refusal(
          'interpolation-syntax',
          `"${clip(text.slice(dollar))}" opens a variable reference it never closes.`,
        ),
      );
    out += braced(text.slice(dollar + 2, close), lookup, options);
    index = close + 1;
  }
  return out;
}

/** The index of the `}` that closes a `${` whose body starts at `start`. */
function closingBrace(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function braced(
  body: string,
  lookup: Lookup,
  options: { collect: boolean },
): string {
  let end = 0;
  while (end < body.length && NAME_PART.test(body[end] ?? '')) end += 1;
  const name = body.slice(0, end);
  if (!NAME.test(name))
    throw new RefusalError(
      refusal(
        'interpolation-syntax',
        `"\${${clip(body)}}" does not start with a variable name.`,
      ),
    );
  const rest = body.slice(end);
  const value = lookup(name);
  if (rest === '') return value ?? '';
  const colon = rest.startsWith(':');
  const operator = rest[colon ? 1 : 0];
  const argument = rest.slice(colon ? 2 : 1);
  // Unset, or (with the colon) set but empty.
  const missing = value === undefined || (colon && value === '');
  switch (operator) {
    case '-':
      return missing ? substitute(argument, lookup, options) : (value ?? '');
    case '?':
      if (options.collect) {
        substitute(argument, lookup, options);
        return '';
      }
      if (missing)
        throw new RefusalError(
          refusal(
            'variable-required',
            `${name} is not set${colon ? ' or empty' : ''}: ${substitute(argument, lookup, options)}.`,
          ),
        );
      return value ?? '';
    default:
      throw new RefusalError(
        refusal(
          'interpolation-operator',
          `"\${${name}${clip(rest)}}" uses the operator "${rest.slice(0, colon ? 2 : 1)}".`,
        ),
      );
  }
}

function clip(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Interpolate every string of a compose value (mapping values and list items,
 * never mapping keys), as Compose does before it reads a document.
 */
export function interpolateDeep<T>(value: T, lookup: Lookup): T {
  if (typeof value === 'string') return interpolate(value, lookup) as T;
  if (Array.isArray(value))
    return value.map((item: unknown) => interpolateDeep(item, lookup)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        interpolateDeep(item, lookup),
      ]),
    ) as T;
  return value;
}

/** Every variable name a compose value references. */
export function referencedNamesDeep(
  value: unknown,
  into = new Set<string>(),
): Set<string> {
  if (typeof value === 'string') referencedNames(value, into);
  else if (Array.isArray(value))
    for (const item of value) referencedNamesDeep(item, into);
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value)) referencedNamesDeep(item, into);
  return into;
}

// --- .env -----------------------------------------------------------------

const KEY_CHAR = /[\p{L}\p{N}_.\-[\]]/u;
const INLINE_SPACE = new Set(['\t', '\v', '\f', '\r', ' ', '\u0085', '\u00A0']);
const SIMPLE_ESCAPES: Record<string, string> = {
  a: '\u0007',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/**
 * Parse a `.env` file as Compose does. `lookup` answers first, as in Compose:
 * a variable the environment sets wins over one the file set earlier, and a
 * bare `KEY` line takes its value from the environment alone.
 */
export function parseDotenv(
  text: string,
  lookup: Lookup = () => undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const resolve: Lookup = (name) => lookup(name) ?? out[name];
  let rest = text.replace(/^\uFEFF/, '');
  let line = 1;
  for (;;) {
    rest = statementStart(rest, () => (line += 1));
    if (rest === '') break;
    const located = keyName(rest, line);
    if (located.inherited) {
      const value = lookup(located.key);
      if (value !== undefined) out[located.key] = value;
      line += 1;
      rest = located.rest;
      continue;
    }
    const extracted = varValue(located.rest, resolve, line);
    out[located.key] = extracted.value;
    line = extracted.line;
    rest = extracted.rest;
  }
  return out;
}

function statementStart(text: string, newline: () => void): string {
  let rest = text;
  for (;;) {
    let index = 0;
    while (index < rest.length && /\s/u.test(rest[index] ?? '')) {
      if (rest[index] === '\n') newline();
      index += 1;
    }
    rest = rest.slice(index);
    if (!rest.startsWith('#')) return rest;
    const end = rest.indexOf('\n');
    if (end === -1) return '';
    rest = rest.slice(end);
  }
}

function dotenvError(line: number, detail: string): RefusalError {
  return new RefusalError(
    refusal('dotenv-syntax', `.env line ${line}: ${detail}.`),
  );
}

function keyName(
  text: string,
  line: number,
): { key: string; rest: string; inherited: boolean } {
  let source = text;
  if (/^export\s+/.test(source)) source = source.slice('export'.length).trim();
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (INLINE_SPACE.has(char)) continue;
    if (char === '=' || char === ':' || char === '\n') {
      const key = source.slice(0, index).trimEnd();
      if (/\s/u.test(key))
        throw dotenvError(line, 'a variable name holds a space');
      if (key === '') throw dotenvError(line, 'a line has no variable name');
      return {
        key,
        rest:
          char === '\n'
            ? source.slice(index + 1)
            : trimInlineStart(source.slice(index + 1)),
        inherited: char === '\n',
      };
    }
    if (!KEY_CHAR.test(char))
      throw dotenvError(line, 'a variable name holds an unexpected character');
  }
  // The last line names a variable without a value: it is inherited.
  const key = source.trimEnd();
  if (/\s/u.test(key)) throw dotenvError(line, 'a variable name holds a space');
  return { key, rest: '', inherited: true };
}

function trimInlineStart(text: string): string {
  let index = 0;
  while (index < text.length && INLINE_SPACE.has(text[index] ?? '')) index += 1;
  return text.slice(index);
}

function varValue(
  text: string,
  lookup: Lookup,
  line: number,
): { value: string; rest: string; line: number } {
  const quote = text[0];
  if (quote !== '"' && quote !== "'") {
    const end = text.indexOf('\n');
    let value = end === -1 ? text : text.slice(0, end);
    const comment = value.indexOf(' #');
    if (comment !== -1) value = value.slice(0, comment);
    value = value.replace(/\s+$/u, '');
    return {
      value: interpolateDotenv(value, lookup, line),
      rest: end === -1 ? '' : text.slice(end + 1),
      line: line + 1,
    };
  }
  let escaped = false;
  let chars = '';
  let current = line;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\n') current += 1;
    if (char !== quote) {
      if (!escaped && char === '\\') {
        escaped = true;
        continue;
      }
      if (escaped) {
        escaped = false;
        chars += '\\';
      }
      chars += char;
      continue;
    }
    if (escaped) {
      escaped = false;
      chars += char;
      continue;
    }
    const value =
      quote === '"'
        ? interpolateDotenv(expandEscapes(chars), lookup, line)
        : chars;
    return { value, rest: text.slice(index + 1), line: current };
  }
  throw dotenvError(line, 'a quoted value never closes');
}

/** compose-go's `expandEscapes`: `\$` becomes `$$` (a literal `$` once
 * interpolated), the C escapes their character, any other `\x` stays. */
function expandEscapes(text: string): string {
  const expanded = text.replace(/\\./gs, (match) => {
    if (match === '\\$') return '$$';
    return SIMPLE_ESCAPES[match[1] ?? ''] ?? match;
  });
  return expanded.replace(/\\([^$])/gs, '$1');
}

function interpolateDotenv(
  value: string,
  lookup: Lookup,
  line: number,
): string {
  try {
    return interpolate(value, lookup);
  } catch (error) {
    // The detail of a malformed reference quotes the value, which in .env
    // may be a secret: only the line is named.
    if (error instanceof RefusalError)
      throw dotenvError(
        line,
        error.refusal.id === 'variable-required'
          ? error.refusal.detail.replace(/\.$/, '')
          : 'a value holds a variable reference Docker Compose would not read',
      );
    throw error;
  }
}

// --- the source of the variables -------------------------------------------

export type InterpolationPath = 'workspace' | 'managed';

export interface InterpolationSource {
  /** Every variable the documents and `.env` reference, with its value. */
  variables: Record<string, string>;
  /** Process variables that shadow a `.env` key of the same name (names only). */
  shadowed: string[];
}

/**
 * The variables the compose documents are interpolated from, per path
 * (design D-10, R-11), so each path keeps the semantics it has on Docker:
 *
 * - `managed`: `.env` alone. The managed runtime already runs Compose
 *   without the ambient environment (`lib/deployment/runtime-command.ts`).
 * - `workspace`: what Compose sees there today. `loadEnv` folds `.env` into
 *   the process environment, the process winning, and Compose is spawned
 *   with that environment. The snapshot keeps only the names the documents
 *   and `.env` reference, and reports a process variable that shadows a
 *   `.env` key.
 */
export function interpolationSource(
  path: InterpolationPath,
  options: {
    dotenv: string;
    processEnvironment?: Readonly<Record<string, string | undefined>>;
    documents: readonly unknown[];
  },
): InterpolationSource {
  const ambient =
    path === 'workspace' ? (options.processEnvironment ?? {}) : {};
  const fromProcess: Lookup = (name) => ambient[name];
  const fileValues = parseDotenv(options.dotenv, fromProcess);
  const referenced = new Set<string>(Object.keys(fileValues));
  for (const document of options.documents)
    referencedNamesDeep(document, referenced);
  for (const name of dotenvReferences(options.dotenv)) referenced.add(name);
  const variables: Record<string, string> = {};
  const shadowed: string[] = [];
  for (const name of [...referenced].sort()) {
    const processValue = ambient[name];
    if (processValue !== undefined) {
      variables[name] = processValue;
      if (name in fileValues && fileValues[name] !== processValue)
        shadowed.push(name);
    } else if (name in fileValues) variables[name] = fileValues[name] ?? '';
  }
  return { variables, shadowed };
}

/** The names a `.env` file reads from elsewhere: references and bare keys. */
function dotenvReferences(text: string): Set<string> {
  const names = new Set<string>();
  parseDotenv(text, (name) => {
    names.add(name);
    return undefined;
  });
  return names;
}
