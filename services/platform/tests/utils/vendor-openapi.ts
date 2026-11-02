/**
 * A vendor's published OpenAPI document as the yardstick for the answers a
 * test says the vendor gives (`CONN-R34`). Given the request a call made and
 * the answer that stands for the vendor's, it names every way the answer
 * departs from what the document says the operation answers: its status,
 * and its body held to the response's schema.
 *
 * The document is data the caller reads from the repository, so the check
 * runs offline. OpenAPI 2.0, the form Slack publishes, and 3.1, the form
 * OpenRouter publishes, are read, both in JSON Schema's 2020-12 dialect: the
 * keywords Slack's 2.0 document uses mean the same there. A document is read
 * the way its vendor means it, which is not always the way a JSON Schema
 * validator reads it:
 *
 * - `required` is not held. A test's answer carries the members its caller
 *   reads, not the vendor's whole record, so what is held is that each
 *   member it does carry has the vendor's type, values and bounds, and is
 *   one the vendor answers wherever the document lists every member of a
 *   record. It is kept where it decides what a value is rather than what it
 *   must carry: in a condition (`not`, `if`), and for the member a
 *   discriminator reads.
 * - `oneOf` names alternatives as `anyOf` does: with members left out, an
 *   answer may fit more than one.
 * - A discriminator chooses the alternative. A record is held to the one its
 *   member names: by the discriminator's mapping, else by the values the
 *   alternative allows that member, else by the name of the schema the
 *   alternative refers to. A record that lacks the member, or names none of
 *   the alternatives, misfits there. Any other value is held to the
 *   alternatives as such.
 * - `nullable: true`, OpenAPI 3.0's keyword that OpenRouter's 3.1 document
 *   still carries, means "or null"; `nullable: false` says nothing.
 * - A list under `items` names alternatives too: of each element where
 *   `type` admits an array, of the value itself elsewhere. Slack writes
 *   `items: [A, B]` where JSON Schema writes `anyOf`; read as written, such
 *   a value is checked against nothing. An empty list names none and is
 *   dropped. A `$ref` into a list of alternatives the reading moves is moved
 *   with it.
 * - A value that fits none of its alternatives is named by how it misfits
 *   those it comes closest to, not by every alternative's errors: most of
 *   those are about records the value was never meant to be.
 * - The operation is the one the document files under the request's verb
 *   and URL. For a vendor that takes every operation by any verb, the URL
 *   alone finds it, and the verb only chooses where the document files the
 *   path under more than one.
 * - Only absolute servers are read: a 2.0 document's host, base path and
 *   schemes, and a 3.1 operation's, path's or document's `servers`, each
 *   variable at its default. A 3.1 document with no servers, or only
 *   relative ones, describes no operation. A 2.0 document's `produces` and
 *   an operation's own `schemes` are not read.
 * - An answer is held to the response its status has, or else the range of
 *   its status (`4XX`); an error with neither is held to the operation's
 *   `default`. The caller says which answers are errors when their status
 *   does not. A body is held only to the schema of a JSON media type.
 * - `format` is not checked: that takes a dependency of its own.
 */

import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020';

import { isRecord } from '../../lib/utils/type-utils';

/** What a vendor answered a call: the HTTP status, and the body as parsed
 * JSON or as text. */
export interface VendorAnswer {
  status: number;
  body: unknown;
}

/**
 * One way an answer departs from the document: where in the answer (a JSON
 * pointer, empty for the whole answer; a member the document does not
 * answer, or a member a discriminator reads that is missing, is named by its
 * own pointer), the keyword it breaks (`status` for a status the operation
 * does not answer with), and why.
 */
export interface VendorMisfit {
  path: string;
  keyword: string;
  detail: string;
}

/** How a vendor's answers are read beyond what its document says. */
export interface VendorReading {
  /** Whether the vendor sends `answer` as an error though its status says
   * the call succeeded, as Slack does a call it refuses: HTTP 200 with
   * `ok: false`. */
  isError?: (answer: VendorAnswer) => boolean;
  /** Whether the vendor takes each operation by any verb, as Slack's Web
   * API takes every method by GET or by POST though its document files each
   * under one: the operation is then found by the URL alone. */
  anyVerb?: boolean;
}

export interface VendorDocument {
  /** Whether the document describes an operation a `method` request to
   * `url` may call: one filed under the URL's path, and under `method`
   * unless the vendor takes any verb. A yes or a no; it never throws. */
  describes(method: string, url: string): boolean;
  /** Every way `answer` departs from what that operation answers, none when
   * it fits. Throws for a request the document does not describe, and, for
   * a vendor that takes any verb, for one to a path the document files
   * under more than one verb but not under the request's. */
  misfitsOf(method: string, url: string, answer: VendorAnswer): VendorMisfit[];
}

// Non-strict, so the vendor's own keywords (`x-examples`, a discriminator
// that names no alternative) pass; verbose, so an error keeps the value
// answered, which its misfit names, and the schema it breaks.
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});

const VERBS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

/** Keywords whose value is one schema, those whose value names schemas, and
 * those whose value lists some. */
const SUBSCHEMA = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'unevaluatedItems',
  'unevaluatedProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
]);
const SUBSCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
]);
const SUBSCHEMA_LISTS = new Set(['allOf', 'anyOf', 'prefixItems']);
/** The keywords whose value may be a list of schemas. */
const LISTED = new Set([...SUBSCHEMA_LISTS, 'oneOf', 'items']);

/** A JSON media type: `application/json`, `application/problem+json`, with
 * or without parameters. */
const JSON_MEDIA_TYPE = /[/+]json\s*(;|$)/i;

/** The keyword a discriminator as read marks its checks with: the values
 * that name its alternatives, which a misfit there lists. */
const DISCRIMINATED = 'x-discriminated';

/** `name` as one segment of a JSON pointer. */
const segment = (name: string | number) =>
  String(name).replaceAll('~', '~0').replaceAll('/', '~1');

/** `parts` as a JSON pointer. */
const pointer = (parts: readonly (string | number)[]) =>
  parts.map((part) => `/${segment(part)}`).join('');

/** The places a local `$ref` (`#/…`) names, one after the other. */
function partsOf(ref: string): string[] {
  return ref
    .slice(2)
    .split('/')
    .map((part) =>
      decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~'),
    );
}

/** `value`, or what it refers to when it is a `$ref` into `root`. */
function dereference(value: unknown, root: unknown): unknown {
  let at = value;
  for (let hops = 0; isRecord(at) && typeof at.$ref === 'string'; hops++) {
    const ref = at.$ref;
    if (hops > 16 || !ref.startsWith('#/')) {
      throw new Error(`the document's $ref ${ref} cannot be followed`);
    }
    at = partsOf(ref).reduce<unknown>(
      (node, part) => (isRecord(node) ? node[part] : undefined),
      root,
    );
  }
  return at;
}

/** A list of schemas `keyword` holds in `schema`, or none. */
function listAt(schema: Record<string, unknown>, keyword: string): unknown[] {
  const list = schema[keyword];
  return Array.isArray(list) ? list : [];
}

/** Whether a schema of `type` may be an array, so that `items` holds its
 * elements. */
function admitsArray(type: unknown): boolean {
  return type === 'array' || (Array.isArray(type) && type.includes('array'));
}

/** The member a schema's `discriminator` reads, its `propertyName`; null
 * for none. OpenAPI 2.0's names a member of a schema other schemas extend,
 * never one of a union, and chooses nothing here. */
function discriminatorOf(discriminator: unknown): string | null {
  return isRecord(discriminator) &&
    typeof discriminator.propertyName === 'string'
    ? discriminator.propertyName
    : null;
}

/** What a discriminator's value chooses: a schema its mapping refers to, or
 * an alternative of its union by index. */
type Choice = { ref: string } | { index: number };

/** Where a schema sits as it is read, and what the reading of a whole
 * document keeps track of. */
interface Place {
  /** The document, for the `$ref`s a discriminator follows. */
  root: unknown;
  /** How the document refers to a schema by its name: `#/definitions/` or
   * `#/components/schemas/`. */
  named: string;
  /** The schema's place in the document, and its place as read. */
  from: readonly string[];
  to: readonly string[];
  /** Whether the schema is part of a condition (`not`, `if`), where
   * `required` says what a value is rather than what it must carry. */
  condition: boolean;
  /** Each place the reading moves, by its pointer in the document, and
   * where it goes: what lies inside goes along. */
  moved: Map<string, readonly string[]>;
  /** The schemas as read that hold a `$ref`, which must point where its
   * target went. */
  refs: Record<string, unknown>[];
}

/** `place` one or more steps further in, the same in the document and as
 * read. */
function step(place: Place, ...steps: string[]): Place {
  return {
    ...place,
    from: [...place.from, ...steps],
    to: [...place.to, ...steps],
  };
}

/**
 * `schema` as the check holds an answer to it (see above): `required`
 * dropped but in a condition, `oneOf` and each list under `items` read as
 * alternatives, `nullable` as "or null", and a discriminated union as the
 * alternative its member names. Only a schema's own keywords are read, so a
 * member a `properties` map names is never taken for one.
 */
export function readSchema(schema: unknown): unknown {
  const place: Place = {
    root: schema,
    named: '#/components/schemas/',
    from: [],
    to: [],
    condition: false,
    moved: new Map(),
    refs: [],
  };
  const read = readNode(schema, place);
  pointRefs(place.refs, place.moved);
  return read;
}

function readNode(schema: unknown, place: Place): unknown {
  return isRecord(schema) ? readRecord(schema, place) : settle(schema, place);
}

/** Record where the schema read at `place` went. It runs after the schemas
 * inside it are read, so a schema the reading wraps (`nullable`) keeps its
 * place while what it holds moves into the wrapper. */
function settle<T>(read: T, place: Place): T {
  const from = pointer(place.from);
  if (from === pointer(place.to)) place.moved.delete(from);
  else place.moved.set(from, place.to);
  return read;
}

/** Point each `$ref` in `refs` at the place its target went, as `moved`
 * says; a `$ref` to a place the reading left alone stays as written. */
function pointRefs(
  refs: readonly Record<string, unknown>[],
  moved: ReadonlyMap<string, readonly string[]>,
): void {
  for (const read of refs) {
    const ref = read.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) continue;
    const to = moved.get(pointer(partsOf(ref)));
    if (to !== undefined) {
      read.$ref = `#${to.map((part) => `/${encodeURIComponent(segment(part))}`).join('')}`;
    }
  }
}

function readRecord(
  schema: Record<string, unknown>,
  place: Place,
): Record<string, unknown> {
  const { nullable, ...rest } = schema;
  if (nullable === true) {
    // Null is an alternative of its own, and any other value is held to the
    // rest, so a misfit is named as the rest names it.
    const others = readRecord(rest, { ...place, to: [...place.to, 'else'] });
    return settle({ if: { type: 'null' }, else: others }, place);
  }
  // A discriminator reads `property` to choose among the alternatives its
  // schema lists under `discriminated`.
  const property = discriminatorOf(rest.discriminator);
  const discriminated =
    property === null
      ? undefined
      : ['oneOf', 'anyOf'].find((keyword) => listAt(rest, keyword).length > 0);
  const read: Record<string, unknown> = {};
  // The lists of alternatives, each with the keyword it is under, placed
  // once every other keyword is read.
  const unions: { keyword: string; list: unknown[] }[] = [];
  for (const [keyword, value] of Object.entries(rest)) {
    if (keyword === 'required' && !place.condition) continue;
    // The union a discriminator reads is placed below, as it chooses.
    const chooses = keyword === discriminated || keyword === 'discriminator';
    if (discriminated !== undefined && chooses) continue;
    if (keyword === '$ref') {
      read.$ref = value;
      place.refs.push(read);
    } else if (SUBSCHEMA_MAPS.has(keyword) && isRecord(value)) {
      read[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, of]) => [
          name,
          readNode(of, step(place, keyword, name)),
        ]),
      );
    } else if (
      Array.isArray(value) &&
      value.length === 0 &&
      LISTED.has(keyword)
    ) {
      // An empty list names no schema, and Ajv refuses one: reading a 2.0
      // document's definitions, it would refuse them all.
      continue;
    } else if (keyword === 'items' && Array.isArray(value)) {
      if (admitsArray(rest.type)) {
        read.items = {
          anyOf: value.map((item, index) =>
            readNode(item, {
              ...place,
              from: [...place.from, 'items', String(index)],
              to: [...place.to, 'items', 'anyOf', String(index)],
            }),
          ),
        };
      } else unions.push({ keyword, list: value });
    } else if (keyword === 'oneOf' && Array.isArray(value)) {
      unions.push({ keyword, list: value });
    } else if (keyword === 'not' || keyword === 'if') {
      read[keyword] = readNode(value, {
        ...step(place, keyword),
        condition: true,
      });
    } else if (SUBSCHEMA.has(keyword)) {
      read[keyword] = readNode(value, step(place, keyword));
    } else if (SUBSCHEMA_LISTS.has(keyword) && Array.isArray(value)) {
      read[keyword] = value.map((item, index) =>
        readNode(item, step(place, keyword, String(index))),
      );
    } else {
      read[keyword] = value;
    }
  }
  // Each list of alternatives is one `anyOf`; a schema that holds more than
  // one holds them all, each a member of its `allOf`.
  const members = () => (Array.isArray(read.allOf) ? read.allOf : []);
  for (const { keyword, list } of unions) {
    const into =
      read.anyOf === undefined
        ? ['anyOf']
        : ['allOf', String(members().length), 'anyOf'];
    const alternatives = list.map((item, index) =>
      readNode(item, {
        ...place,
        from: [...place.from, keyword, String(index)],
        to: [...place.to, ...into, String(index)],
      }),
    );
    if (read.anyOf === undefined) read.anyOf = alternatives;
    else read.allOf = [...members(), { anyOf: alternatives }];
  }
  if (property !== null && discriminated !== undefined) {
    const listed = listAt(rest, discriminated);
    const choices = choicesOf(property, rest.discriminator, listed, place);
    const index = String(members().length);
    const into =
      choices.size > 0
        ? ['allOf', index, 'else', 'anyOf']
        : ['allOf', index, 'anyOf'];
    const alternatives = listed.map((item, at) =>
      readNode(item, {
        ...place,
        from: [...place.from, discriminated, String(at)],
        to: [...place.to, ...into, String(at)],
      }),
    );
    read.allOf = [
      ...members(),
      choices.size > 0
        ? discriminatedUnion(property, choices, alternatives, place)
        : { anyOf: alternatives },
    ];
  }
  return settle(read, place);
}

/** The string values `schema`, an alternative of a discriminated union,
 * allows the member `property`, or null for none. */
function valuesOf(
  schema: unknown,
  property: string,
  root: unknown,
): string[] | null {
  const read = dereference(schema, root);
  if (!isRecord(read) || !isRecord(read.properties)) return null;
  const member = dereference(read.properties[property], root);
  if (!isRecord(member)) return null;
  const values = Object.hasOwn(member, 'const')
    ? [member.const]
    : listAt(member, 'enum');
  const named = values.filter(
    (value): value is string => typeof value === 'string',
  );
  return named.length > 0 ? named : null;
}

/**
 * What each value of the member `property` chooses among `listed`, the
 * alternatives of a union `discriminator` reads: the schema the mapping
 * refers it to, and for an alternative the mapping does not name, the
 * values it allows the member, or else the name of the schema it refers to,
 * as OpenAPI says.
 */
function choicesOf(
  property: string,
  discriminator: unknown,
  listed: readonly unknown[],
  place: Place,
): Map<string, Choice> {
  const choices = new Map<string, Choice>();
  const mapping =
    isRecord(discriminator) && isRecord(discriminator.mapping)
      ? discriminator.mapping
      : {};
  const mapped = new Set<string>();
  for (const [value, target] of Object.entries(mapping)) {
    // An `x-` entry is the vendor's own and names no schema; nor does a
    // target the document does not hold.
    if (value.startsWith('x-') || typeof target !== 'string') continue;
    const ref = target.startsWith('#/') ? target : `${place.named}${target}`;
    if (!isRecord(dereference({ $ref: ref }, place.root))) continue;
    choices.set(value, { ref });
    mapped.add(ref);
  }
  listed.forEach((alternative, index) => {
    const ref =
      isRecord(alternative) && typeof alternative.$ref === 'string'
        ? alternative.$ref
        : null;
    if (ref !== null && mapped.has(ref)) return;
    const name = ref?.startsWith('#/') === true ? partsOf(ref).at(-1) : null;
    const values =
      valuesOf(alternative, property, place.root) ??
      (typeof name === 'string' ? [name] : []);
    for (const value of values) {
      if (!choices.has(value)) choices.set(value, { index });
    }
  });
  return choices;
}

/**
 * A union a discriminator reads, as the check holds a value to it: a record
 * must carry the member `property` with a value that names an alternative,
 * and is held to that alternative alone; any other value is held to the
 * alternatives as such. Its checks carry the values that name an
 * alternative, which a misfit there lists.
 */
function discriminatedUnion(
  property: string,
  choices: ReadonlyMap<string, Choice>,
  alternatives: readonly unknown[],
  place: Place,
): Record<string, unknown> {
  const values = [...choices.keys()];
  const chosen = [...choices].map(([value, choice]) => {
    let then: unknown;
    if ('ref' in choice) {
      const target = { $ref: choice.ref };
      place.refs.push(target);
      then = target;
    } else then = alternatives[choice.index];
    return {
      if: {
        properties: { [property]: { const: value } },
        required: [property],
      },
      // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema's `then` keyword: its value is a schema, never a function, so nothing awaits it as a thenable
      then,
    };
  });
  return {
    if: { type: 'object' },
    // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema's `then` keyword: its value is a schema, never a function, so nothing awaits it as a thenable
    then: {
      [DISCRIMINATED]: values,
      required: [property],
      properties: { [property]: { [DISCRIMINATED]: values, enum: values } },
      allOf: chosen,
    },
    else: { anyOf: alternatives },
  };
}

/** `values` as prose: `"a", "b" or "c"`. */
function listing(values: readonly unknown[]): string {
  const named = values.map((value) => JSON.stringify(value));
  const last = named.pop() ?? '';
  return named.length > 0 ? `${named.join(', ')} or ${last}` : last;
}

/** One of Ajv's errors as a misfit: a member the document does not answer
 * by its own path, a discriminator's member that is missing or names no
 * alternative by its path with the values that do, anything else with
 * Ajv's reason, after the value answered when that is no object or list. */
function misfitOf(error: ErrorObject): VendorMisfit {
  const params: Record<string, unknown> = error.params;
  const member = params.additionalProperty ?? params.unevaluatedProperty;
  if (typeof member === 'string') {
    return {
      path: `${error.instancePath}/${segment(member)}`,
      keyword: error.keyword,
      detail: 'is no member of the answer the document describes',
    };
  }
  const value: unknown = error.data;
  const parent: unknown = error.parentSchema;
  const named = isRecord(parent) ? parent[DISCRIMINATED] : undefined;
  if (Array.isArray(named)) {
    const { missingProperty } = params;
    if (error.keyword === 'required' && typeof missingProperty === 'string') {
      return {
        path: `${error.instancePath}/${segment(missingProperty)}`,
        keyword: error.keyword,
        detail: `is missing: it names the alternative the value is held to (${listing(named)})`,
      };
    }
    if (error.keyword === 'enum') {
      return {
        path: error.instancePath,
        keyword: error.keyword,
        detail: `${JSON.stringify(value)} names no alternative (${listing(named)})`,
      };
    }
  }
  const reason = error.message ?? 'is invalid';
  return {
    path: error.instancePath,
    keyword: error.keyword,
    detail:
      typeof value === 'object' && value !== null
        ? reason
        : `${JSON.stringify(value)} ${reason}`,
  };
}

/** `misfits` with each place and keyword named once, and its distinct
 * reasons joined: the alternatives a value comes closest to may each misfit
 * at the same place, for reasons of their own. */
function merged(misfits: VendorMisfit[]): VendorMisfit[] {
  const places = new Map<
    string,
    { path: string; keyword: string; details: Set<string> }
  >();
  for (const { path, keyword, detail } of misfits) {
    const key = `${path} ${keyword}`;
    const place = places.get(key) ?? { path, keyword, details: new Set() };
    place.details.add(detail);
    places.set(key, place);
  }
  return [...places.values()].map(({ path, keyword, details }) => ({
    path,
    keyword,
    detail: [...details].join(' or '),
  }));
}

/** `url` without its query, fragment and trailing slash, as an operation's
 * URL is matched. */
function baseOf(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname.replace(/\/$/, '')}`;
}

/** The base URLs of the first of `levels` (an operation's, its path's, the
 * document's) that lists servers, with each variable at its default; a
 * server named relative to the document is left out. */
function serverBases(...levels: unknown[]): string[] {
  const servers = levels.find(
    (level) => Array.isArray(level) && level.length > 0,
  );
  if (!Array.isArray(servers)) return [];
  return servers.flatMap((server) => {
    if (!isRecord(server) || typeof server.url !== 'string') return [];
    const variables = isRecord(server.variables) ? server.variables : {};
    const url = server.url.replace(/\{([^}]*)\}/g, (whole, name: string) => {
      const variable = variables[name];
      return isRecord(variable) && typeof variable.default === 'string'
        ? variable.default
        : whole;
    });
    return URL.canParse(url) ? [baseOf(url)] : [];
  });
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An operation the document describes, with what matches a request's URL
 * to it: one of its bases, then its path, a `{name}` in it standing for one
 * segment. */
interface Operation {
  verb: string;
  path: string;
  templated: boolean;
  url: RegExp;
  responses: Record<string, unknown>;
}

/** Read `document`, a vendor's OpenAPI 2.0 or 3.1 document, to hold answers
 * to it as `reading` says; throws for any other kind of document. */
export function readVendorDocument(
  document: unknown,
  reading: VendorReading = {},
): VendorDocument {
  if (!isRecord(document)) throw new Error('the document is no JSON object');
  const form =
    document.swagger === '2.0'
      ? '2.0'
      : typeof document.openapi === 'string' &&
          /^3\.1\.\d+$/.test(document.openapi)
        ? '3.1'
        : null;
  if (form === null) {
    throw new Error('only an OpenAPI 2.0 or 3.1 document is read');
  }
  const { paths } = document;
  if (!isRecord(paths)) throw new Error('the document describes no paths');

  // Where the schemas a `$ref` reaches by name are, and each place the
  // reading of them moves.
  const named = form === '2.0' ? ['definitions'] : ['components', 'schemas'];
  const moved = new Map<string, readonly string[]>();

  /** The schemas `schemas` names, at `named` in the document, read as the
   * answers are. */
  function readNamed(schemas: unknown): Record<string, unknown> {
    if (!isRecord(schemas)) return {};
    const place: Place = {
      root: document,
      named: `#${pointer(named)}/`,
      from: named,
      to: named,
      condition: false,
      moved,
      refs: [],
    };
    const read = Object.fromEntries(
      Object.entries(schemas).map(([name, of]) => [
        name,
        readNode(of, step(place, name)),
      ]),
    );
    pointRefs(place.refs, moved);
    return read;
  }

  /** A response's schema, read as the answers are, its `$ref`s pointing
   * where the schemas they reach went. */
  function readResponseSchema(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const place: Place = {
      root: document,
      named: `#${pointer(named)}/`,
      from: [],
      to: [],
      condition: false,
      // A place in a response is no place a `$ref` names.
      moved: new Map(),
      refs: [],
    };
    const read = readRecord(schema, place);
    pointRefs(place.refs, moved);
    return read;
  }

  // The document's own bases (2.0 names one host and base path for every
  // operation), and the schemas a `$ref` reaches, read as the answers are,
  // at the place in the document the reference names.
  let documentBases: string[] = [];
  let reachable: Record<string, unknown>;
  if (form === '2.0') {
    const { host, basePath = '', schemes = ['https'], definitions } = document;
    if (typeof host !== 'string' || typeof basePath !== 'string') {
      throw new Error('the document names no host or base path');
    }
    documentBases = (Array.isArray(schemes) ? schemes : [])
      .filter((scheme): scheme is string => typeof scheme === 'string')
      .map((scheme) => baseOf(`${scheme}://${host}${basePath}`));
    reachable = { definitions: readNamed(definitions) };
  } else {
    const { components } = document;
    reachable = {
      components: {
        schemas: readNamed(isRecord(components) ? components.schemas : {}),
      },
    };
  }

  const operations: Operation[] = Object.entries(paths).flatMap(
    ([path, pathItem]) => {
      const item = dereference(pathItem, document);
      if (!isRecord(item)) return [];
      return VERBS.flatMap((verb) => {
        const operation = item[verb];
        if (!isRecord(operation)) return [];
        const bases =
          form === '2.0'
            ? documentBases
            : serverBases(operation.servers, item.servers, document.servers);
        if (bases.length === 0) return [];
        const { responses } = operation;
        return [
          {
            verb,
            path,
            templated: path.includes('{'),
            url: new RegExp(
              `^(?:${bases.map(escaped).join('|')})${path
                .replace(/\/$/, '')
                .split(/\{[^}]*\}/)
                .map(escaped)
                .join('[^/]+')}$`,
            ),
            responses: isRecord(responses) ? responses : {},
          },
        ];
      });
    },
  );

  // Each schema checked, compiled once: one of the document's, as read, by
  // its identity, and a schema that is true or false by its value.
  const checks = new WeakMap<object, ValidateFunction>();
  const verdicts = new Map<unknown, ValidateFunction>();
  const responseSchemas = new Map<string, Record<string, unknown> | null>();

  /** The errors Ajv finds in `value` held to `schema`, one of the
   * document's as read. */
  function errorsOf(schema: unknown, value: unknown): ErrorObject[] {
    let check = isRecord(schema) ? checks.get(schema) : verdicts.get(schema);
    if (check === undefined) {
      // Under `allOf`, so a schema that is only a `$ref` keeps the schemas
      // it reaches beside it.
      check = ajv.compile({ ...reachable, allOf: [schema] });
      if (isRecord(schema)) checks.set(schema, check);
      else verdicts.set(schema, check);
    }
    if (check(value)) return [];
    // Copied before another check runs, which may be this same one, run
    // again for a value inside this one.
    return [...(check.errors ?? [])];
  }

  /** Every way `value` departs from `schema`, a schema of the document as
   * read, and how many errors Ajv found for them. */
  function misfitsAgainst(
    schema: unknown,
    value: unknown,
  ): { errors: number; misfits: VendorMisfit[] } {
    const errors = errorsOf(schema, value);
    // Each entry: the first of the errors it stands for, and the misfits
    // they name.
    const found: { from: number; misfits: VendorMisfit[] }[] = [];
    errors.forEach((error, index) => {
      // A condition's own error says only that its clause failed, and the
      // clause's errors come before it.
      if (error.keyword === 'if') return;
      const alternatives: unknown = error.schema;
      if (error.keyword !== 'anyOf' || !Array.isArray(alternatives)) {
        found.push({ from: index, misfits: [misfitOf(error)] });
        return;
      }
      // Ajv reports a failed `anyOf` right after the errors of its
      // alternatives, which are as many as the alternatives find checked
      // alone. Those errors, and only those, give way to the misfits of the
      // alternatives the value comes closest to.
      const at = error.instancePath;
      const tried = alternatives.map((alternative) =>
        misfitsAgainst(alternative, error.data),
      );
      const from =
        index - tried.reduce((count, { errors: run }) => count + run, 0);
      while ((found.at(-1)?.from ?? -1) >= from) found.pop();
      const fewest = Math.min(...tried.map(({ misfits }) => misfits.length));
      const closest = tried
        .filter(({ misfits }) => misfits.length === fewest)
        .flatMap(({ misfits }) => misfits)
        .map(({ path, keyword, detail }) => ({
          path: `${at}${path}`,
          keyword,
          detail,
        }));
      found.push({
        from,
        misfits: closest.length > 0 ? closest : [misfitOf(error)],
      });
    });
    return {
      errors: errors.length,
      misfits: merged(found.flatMap(({ misfits }) => misfits)),
    };
  }

  /** The operations a `method` request to `url` may call: those filed under
   * a path its URL matches, and under its verb unless the vendor takes any
   * verb. A path with no `{name}` in it goes before one that has, as OpenAPI
   * says. */
  function candidatesOf(method: string, url: string): Operation[] {
    if (!URL.canParse(url)) return [];
    const target = baseOf(url);
    const verb = method.toLowerCase();
    const found = operations.filter(
      (operation) =>
        operation.url.test(target) &&
        (reading.anyVerb === true || operation.verb === verb),
    );
    const literal = found.filter((operation) => !operation.templated);
    return literal.length > 0 ? literal : found;
  }

  /** The operation a `method` request to `url` calls, or null: the one
   * filed under the request's verb, else, for a vendor that takes any verb,
   * the one the URL alone finds. A path filed under more than one verb, none
   * of them the request's, leaves that ambiguous. */
  function operationOf(method: string, url: string): Operation | null {
    const found = candidatesOf(method, url);
    const verb = method.toLowerCase();
    const chosen = found.find((operation) => operation.verb === verb);
    if (chosen !== undefined) return chosen;
    const [first] = found;
    if (first === undefined) return null;
    if (found.some((other) => other !== first && other.path === first.path)) {
      throw new Error(
        `${method} ${url}: the document files ${first.path} under more than one verb, and not under ${method}`,
      );
    }
    return first;
  }

  /** Whether `answer` is an error the vendor sends with a success status. */
  const isErrorAsSuccess = (answer: VendorAnswer) =>
    answer.status < 400 && reading.isError?.(answer) === true;

  /** The response `answer` is held to: the one its status has, or its
   * status's range, unless it is an error sent with a success status; else
   * `default` for an error. */
  function responseOf(
    responses: Record<string, unknown>,
    answer: VendorAnswer,
  ): string | null {
    const status = String(answer.status);
    const errorAsSuccess = isErrorAsSuccess(answer);
    if (!errorAsSuccess) {
      if (Object.hasOwn(responses, status)) return status;
      const range = Object.keys(responses).find(
        (key) => key.toUpperCase() === `${status.charAt(0)}XX`,
      );
      if (range !== undefined) return range;
    }
    if (
      (answer.status >= 400 || errorAsSuccess) &&
      Object.hasOwn(responses, 'default')
    ) {
      return 'default';
    }
    return null;
  }

  /** Why the operation filed under `path` has no response to hold `answer`
   * to, with the responses it does document. */
  function noResponseFor(
    path: string,
    responses: Record<string, unknown>,
    answer: VendorAnswer,
  ): string {
    const documented = Object.keys(responses).join(', ') || 'none';
    if (isErrorAsSuccess(answer)) {
      return `${path} documents no error answer (no default) for an error sent with status ${answer.status}; it documents ${documented}`;
    }
    if (answer.status >= 400) {
      return `${path} documents no answer with status ${answer.status} and no error answer (no default); it documents ${documented}`;
    }
    return `${path} gives no answer with status ${answer.status} (it documents ${documented})`;
  }

  /** The schema a response holds its body to, or null for none. */
  function bodySchemaOf(response: unknown): Record<string, unknown> | null {
    const read = dereference(response, document);
    if (!isRecord(read)) return null;
    if (form === '2.0') return isRecord(read.schema) ? read.schema : null;
    const { content } = read;
    if (!isRecord(content)) return null;
    const type = Object.keys(content).find((key) => JSON_MEDIA_TYPE.test(key));
    const media = type === undefined ? undefined : content[type];
    return isRecord(media) && isRecord(media.schema) ? media.schema : null;
  }

  return {
    describes: (method, url) => candidatesOf(method, url).length > 0,
    misfitsOf(method, url, answer) {
      const operation = operationOf(method, url);
      if (operation === null) {
        throw new Error(
          `the document describes no operation for ${method} ${url}`,
        );
      }
      const { verb, path, responses } = operation;
      const key = responseOf(responses, answer);
      if (key === null) {
        return [
          {
            path: '',
            keyword: 'status',
            detail: noResponseFor(path, responses, answer),
          },
        ];
      }
      const id = `${verb} ${path} ${key}`;
      let schema = responseSchemas.get(id);
      if (schema === undefined) {
        const found = bodySchemaOf(responses[key]);
        schema = found === null ? null : readResponseSchema(found);
        responseSchemas.set(id, schema);
      }
      return schema === null ? [] : misfitsAgainst(schema, answer.body).misfits;
    },
  };
}
