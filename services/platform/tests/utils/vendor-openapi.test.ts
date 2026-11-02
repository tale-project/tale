import { describe, expect, it } from 'vitest';

import { isRecord } from '../../lib/utils/type-utils';
import {
  readSchema,
  readVendorDocument,
  type VendorAnswer,
  type VendorMisfit,
} from './vendor-openapi';

/** A small document in Slack's manner: OpenAPI 2.0, an error under
 * `default`, and alternatives listed under `items`. */
const DOCUMENT = {
  swagger: '2.0',
  host: 'api.example.com',
  basePath: '/v1',
  paths: {
    '/things.list': {
      get: {
        responses: {
          '200': {
            description: 'The things',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['ok', 'things'],
              properties: {
                ok: { type: 'boolean' },
                things: {
                  type: 'array',
                  minItems: 1,
                  items: { $ref: '#/definitions/thing' },
                },
                next: { items: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
          default: {
            description: 'An error',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['ok', 'error'],
              properties: {
                ok: { enum: [false] },
                error: { type: 'string', enum: ['not_found'] },
              },
            },
          },
        },
      },
    },
    '/things.touch': {
      post: { responses: { '204': { description: 'Touched' } } },
    },
    '/things.both': {
      get: { responses: { '200': { description: 'Got' } } },
      post: { responses: { '201': { description: 'Posted' } } },
    },
  },
  definitions: {
    thing: {
      items: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name'],
          properties: {
            id: { type: 'string', pattern: '^T' },
            name: { type: 'string' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'archived'],
          properties: {
            id: { type: 'string', pattern: '^T' },
            archived: { type: 'boolean' },
          },
        },
      ],
    },
  },
};

const LIST = 'https://api.example.com/v1/things.list';
const TOUCH = 'https://api.example.com/v1/things.touch';
const BOTH = 'https://api.example.com/v1/things.both';

/** Errors come with HTTP 200 and `ok: false`, as Slack sends them. */
const isError = (answer: VendorAnswer) =>
  isRecord(answer.body) && answer.body.ok === false;
const document = readVendorDocument(DOCUMENT, { isError });

/** Where `answer` to a `method` request to `url` misfits, and which keyword
 * it breaks. */
function misfits(
  answer: VendorAnswer,
  url = LIST,
  method = 'GET',
  read = document,
): string[] {
  return read
    .misfitsOf(method, url, answer)
    .map(({ path, keyword }) => `${path} ${keyword}`);
}

describe('an answer held against an OpenAPI 2.0 document [CONN-R34]', () => {
  it('passes an answer that carries only some of the members the document requires', () => {
    expect(
      misfits({ status: 200, body: { ok: true, things: [{ id: 'T1' }] } }),
    ).toEqual([]);
  });

  it('names a member the document does not answer by its own path', () => {
    expect(
      misfits({
        status: 200,
        body: { ok: true, things: [{ id: 'T1' }], cursor: 'c1' },
      }),
    ).toEqual(['/cursor additionalProperties']);
  });

  it('names a member of another type with the value answered', () => {
    expect(
      document.misfitsOf('GET', LIST, { status: 200, body: { ok: 'yes' } }),
    ).toEqual([
      { path: '/ok', keyword: 'type', detail: '"yes" must be boolean' },
    ]);
  });

  it('reads a list under items as alternatives, for each element of a list and for a value', () => {
    expect(
      misfits({
        status: 200,
        body: {
          ok: true,
          things: [
            { id: 'T1', name: 'one' },
            { id: 'T2', archived: true },
          ],
          next: null,
        },
      }),
    ).toEqual([]);
  });

  it('names a value that fits no alternative by the alternatives it comes closest to', () => {
    expect(
      misfits({
        status: 200,
        body: { ok: true, things: [{ id: 'T1', name: 'one', colour: 'red' }] },
      }),
    ).toEqual(['/things/0/colour additionalProperties']);
    expect(
      misfits({
        status: 200,
        body: { ok: true, things: [{ id: 'T1', name: 'one', archived: true }] },
      }),
    ).toEqual([
      '/things/0/archived additionalProperties',
      '/things/0/name additionalProperties',
    ]);
    expect(
      document.misfitsOf('GET', LIST, {
        status: 200,
        body: { ok: true, things: [{ id: 'T1' }], next: 5 },
      }),
    ).toEqual([
      {
        path: '/next',
        keyword: 'type',
        detail: '5 must be string or 5 must be null',
      },
    ]);
  });

  it('holds a list to its bounds', () => {
    expect(misfits({ status: 200, body: { ok: true, things: [] } })).toEqual([
      '/things minItems',
    ]);
  });

  it('holds an error the vendor sends with a success status to the default response', () => {
    expect(
      misfits({ status: 200, body: { ok: false, error: 'not_found' } }),
    ).toEqual([]);
    expect(
      document.misfitsOf('GET', LIST, {
        status: 200,
        body: { ok: false, error: 'gone' },
      }),
    ).toEqual([
      {
        path: '/error',
        keyword: 'enum',
        detail: '"gone" must be equal to one of the allowed values',
      },
    ]);
  });

  it('holds an error status the operation has no response for to the default response', () => {
    expect(
      misfits({ status: 429, body: { ok: false, error: 'not_found' } }),
    ).toEqual([]);
  });

  it('names a success status the operation does not answer with', () => {
    expect(
      document.misfitsOf('GET', LIST, {
        status: 201,
        body: { ok: true, things: [{ id: 'T1' }] },
      }),
    ).toEqual([
      {
        path: '',
        keyword: 'status',
        detail:
          '/things.list gives no answer with status 201 (it documents 200, default)',
      },
    ]);
  });

  it('holds only the status of a response that describes no body', () => {
    expect(misfits({ status: 204, body: '' }, TOUCH, 'POST')).toEqual([]);
    expect(misfits({ status: 200, body: '' }, TOUCH, 'POST')).toEqual([
      ' status',
    ]);
  });

  it('describes only the operations under its host and base path, each under its verb', () => {
    expect(document.describes('GET', LIST)).toBe(true);
    expect(document.describes('GET', `${LIST}?cursor=c1`)).toBe(true);
    expect(document.describes('POST', LIST)).toBe(false);
    expect(
      document.describes('GET', 'https://api.example.com/v2/things.list'),
    ).toBe(false);
    expect(
      document.describes('GET', 'https://files.example.com/v1/things.list'),
    ).toBe(false);
    expect(
      document.describes('GET', 'https://api.example.com/v1/things.gone'),
    ).toBe(false);
    expect(() =>
      document.misfitsOf('GET', 'https://api.example.com/v1/things.gone', {
        status: 200,
        body: {},
      }),
    ).toThrow(
      'the document describes no operation for GET https://api.example.com/v1/things.gone',
    );
    expect(document.describes('POST', BOTH)).toBe(true);
  });

  it('names an error the operation documents no error answer for, and the statuses it documents', () => {
    expect(
      document.misfitsOf('GET', BOTH, {
        status: 200,
        body: { ok: false, error: 'not_found' },
      }),
    ).toEqual([
      {
        path: '',
        keyword: 'status',
        detail:
          '/things.both documents no error answer (no default) for an error sent with status 200; it documents 200',
      },
    ]);
    expect(
      document.misfitsOf('POST', TOUCH, { status: 500, body: '' }),
    ).toEqual([
      {
        path: '',
        keyword: 'status',
        detail:
          '/things.touch documents no answer with status 500 and no error answer (no default); it documents 204',
      },
    ]);
  });

  it('finds the operation by the URL alone for a vendor that takes any verb, and by the verb where the path is filed under more than one', () => {
    const anyVerb = readVendorDocument(DOCUMENT, { isError, anyVerb: true });
    expect(
      misfits({ status: 200, body: { ok: 'yes' } }, LIST, 'POST', anyVerb),
    ).toEqual(['/ok type']);
    expect(misfits({ status: 201, body: '' }, BOTH, 'POST', anyVerb)).toEqual(
      [],
    );
    expect(misfits({ status: 200, body: '' }, BOTH, 'GET', anyVerb)).toEqual(
      [],
    );
    expect(() =>
      anyVerb.misfitsOf('PUT', BOTH, { status: 200, body: '' }),
    ).toThrow(
      `PUT ${BOTH}: the document files /things.both under more than one verb, and not under PUT`,
    );
  });

  it('says whether it describes a request with a yes or a no, never by throwing', () => {
    const anyVerb = readVendorDocument(DOCUMENT, { isError, anyVerb: true });
    expect(anyVerb.describes('POST', BOTH)).toBe(true);
    expect(anyVerb.describes('PUT', BOTH)).toBe(true);
    expect(document.describes('GET', 'no URL at all')).toBe(false);
  });

  it('drops an empty list of alternatives, which Ajv refuses in any schema the document holds', () => {
    const emptied = readVendorDocument(
      {
        ...DOCUMENT,
        definitions: { ...DOCUMENT.definitions, nothing: { items: [] } },
      },
      { isError },
    );
    expect(
      misfits(
        { status: 200, body: { ok: true, things: [{ id: 'T1' }] } },
        LIST,
        'GET',
        emptied,
      ),
    ).toEqual([]);
  });
});

/** A small document in OpenRouter's manner: OpenAPI 3.1, servers named for
 * the document and for an operation, a server variable, responses by
 * `$ref`, a range of statuses, and alternatives under `oneOf`. */
const DOCUMENT_31 = {
  openapi: '3.1.0',
  info: { title: 'Things', version: '1.0.0' },
  servers: [
    {
      url: 'https://{region}.example.org/api',
      variables: { region: { default: 'eu' } },
    },
  ],
  paths: {
    '/things/{id}': {
      get: {
        responses: {
          '200': {
            description: 'A thing',
            content: {
              'text/plain': { schema: { type: 'string' } },
              'application/json; charset=utf-8': {
                schema: { $ref: '#/components/schemas/Thing' },
              },
            },
          },
          '4XX': { $ref: '#/components/responses/Refused' },
        },
      },
    },
    '/things/mine': {
      get: {
        responses: {
          '200': {
            description: 'Mine',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { mine: { const: true } },
                },
              },
            },
          },
        },
      },
    },
    '/decide': {
      post: {
        servers: [{ url: 'https://example.org' }],
        responses: {
          '200': {
            description: 'Decided',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    answers: {
                      type: 'object',
                      additionalProperties: {
                        oneOf: [
                          { $ref: '#/components/schemas/Choice' },
                          { $ref: '#/components/schemas/Score' },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          note: { type: ['string', 'null'] },
        },
      },
      Choice: {
        type: 'object',
        required: ['type', 'choice'],
        properties: {
          type: { type: 'string', enum: ['choice'] },
          choice: { type: 'string' },
        },
      },
      Score: {
        type: 'object',
        required: ['type', 'score'],
        properties: {
          type: { type: 'string', enum: ['score'] },
          score: { type: 'number' },
        },
      },
    },
    responses: {
      Refused: {
        description: 'Refused',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'integer' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const THING = 'https://eu.example.org/api/things/T1';
const MINE = 'https://eu.example.org/api/things/mine';
const DECIDE = 'https://example.org/decide';

const document31 = readVendorDocument(DOCUMENT_31);

describe('an answer held against an OpenAPI 3.1 document [CONN-R34]', () => {
  it('holds a body to the schema of its JSON media type, through a $ref', () => {
    expect(
      misfits(
        { status: 200, body: { id: 'T1', note: null } },
        THING,
        'GET',
        document31,
      ),
    ).toEqual([]);
    expect(
      document31.misfitsOf('GET', THING, {
        status: 200,
        body: { id: 'T1', note: 5 },
      }),
    ).toEqual([
      { path: '/note', keyword: 'type', detail: '5 must be string,null' },
    ]);
  });

  it('calls the operation of a path without a template before one with', () => {
    expect(
      misfits({ status: 200, body: { mine: true } }, MINE, 'GET', document31),
    ).toEqual([]);
  });

  it('holds an answer to the range of its status', () => {
    expect(
      misfits(
        { status: 404, body: { error: { code: 404, message: 'No thing' } } },
        THING,
        'GET',
        document31,
      ),
    ).toEqual([]);
    expect(
      misfits(
        { status: 404, body: { error: 'gone' } },
        THING,
        'GET',
        document31,
      ),
    ).toEqual(['/error type']);
    expect(
      document31.misfitsOf('GET', THING, { status: 500, body: {} }),
    ).toEqual([
      {
        path: '',
        keyword: 'status',
        detail:
          '/things/{id} documents no answer with status 500 and no error answer (no default); it documents 200, 4XX',
      },
    ]);
  });

  it('reads oneOf as alternatives an answer may fit more than one of', () => {
    expect(
      misfits(
        { status: 200, body: { answers: { a: {} } } },
        DECIDE,
        'POST',
        document31,
      ),
    ).toEqual([]);
    expect(
      misfits(
        { status: 200, body: { answers: { a: { type: 'box' } } } },
        DECIDE,
        'POST',
        document31,
      ),
    ).toEqual(['/answers/a/type enum']);
  });

  it('finds an operation under its own servers and its verb, a server variable at its default', () => {
    expect(document31.describes('GET', THING)).toBe(true);
    expect(document31.describes('POST', THING)).toBe(false);
    expect(
      document31.describes('GET', 'https://example.org/api/things/T1'),
    ).toBe(false);
    expect(document31.describes('POST', DECIDE)).toBe(true);
    expect(
      document31.describes('POST', 'https://eu.example.org/api/decide'),
    ).toBe(false);
  });
});

/** How `body` departs from `schema`, the schema an operation of a 3.1
 * document answers with, `schemas` the document's named schemas. */
function heldTo(
  schema: unknown,
  body: unknown,
  schemas: Record<string, unknown> = {},
): VendorMisfit[] {
  return readVendorDocument({
    openapi: '3.1.0',
    info: { title: 'It', version: '1.0.0' },
    servers: [{ url: 'https://example.org' }],
    paths: {
      '/it': {
        get: {
          responses: {
            '200': {
              description: 'It',
              content: { 'application/json': { schema } },
            },
          },
        },
      },
    },
    components: { schemas },
  }).misfitsOf('GET', 'https://example.org/it', { status: 200, body });
}

/** Each misfit's place and the keyword it breaks. */
const places = (found: readonly VendorMisfit[]) =>
  found.map(({ path, keyword }) => `${path} ${keyword}`);

describe('a vendor schema as an answer is held to it [CONN-R34]', () => {
  it('reads only an OpenAPI 2.0 or 3.1 document', () => {
    expect(() => readVendorDocument({ openapi: '3.0.3', paths: {} })).toThrow(
      'only an OpenAPI 2.0 or 3.1 document is read',
    );
  });

  it('never takes a member named like a keyword for one', () => {
    expect(
      readSchema({
        type: 'object',
        required: ['required', 'items'],
        properties: {
          required: { type: 'string' },
          items: { type: 'array', items: [{ type: 'string' }] },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        required: { type: 'string' },
        items: { type: 'array', items: { anyOf: [{ type: 'string' }] } },
      },
    });
  });

  it('reads oneOf and a list under items each as one anyOf', () => {
    expect(
      readSchema({
        oneOf: [{ type: 'string' }, { type: 'null' }],
        items: [{ minLength: 1 }],
      }),
    ).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
      allOf: [{ anyOf: [{ minLength: 1 }] }],
    });
  });

  it('keeps each misfit beside a list of alternatives', () => {
    const either = [
      { properties: { b: { type: 'string' } } },
      { properties: { b: { type: 'number' } } },
    ];
    expect(
      places(
        heldTo(
          { enum: ['a', 5], oneOf: [{ type: 'string' }, { type: 'number' }] },
          true,
        ),
      ).sort(),
    ).toEqual([' enum', ' type']);
    expect(
      places(
        heldTo(
          { allOf: [{ properties: { a: { type: 'string' } } }], oneOf: either },
          { a: 5, b: true },
        ),
      ).sort(),
    ).toEqual(['/a type', '/b type']);
    expect(
      places(
        heldTo(
          { $ref: '#/components/schemas/Named', oneOf: either },
          { a: 5, b: true },
          { Named: { properties: { a: { type: 'string' } } } },
        ),
      ).sort(),
    ).toEqual(['/a type', '/b type']);
    expect(
      places(
        heldTo(
          {
            oneOf: [{ type: 'number' }, { type: 'boolean' }],
            items: [{ minLength: 3 }],
          },
          'ab',
        ),
      ).sort(),
    ).toEqual([' minLength', ' type']);
  });

  it('holds a record to the alternative its discriminator names, by the value each allows it', () => {
    const { schemas } = DOCUMENT_31.components;
    const union = {
      oneOf: [
        { $ref: '#/components/schemas/Choice' },
        { $ref: '#/components/schemas/Score' },
      ],
      discriminator: { propertyName: 'type' },
    };
    expect(heldTo(union, { type: 'choice', choice: 'a' }, schemas)).toEqual([]);
    expect(heldTo(union, { type: 'choice', choice: 5 }, schemas)).toEqual([
      { path: '/choice', keyword: 'type', detail: '5 must be string' },
    ]);
    expect(heldTo(union, { choice: 'a' }, schemas)).toEqual([
      {
        path: '/type',
        keyword: 'required',
        detail:
          'is missing: it names the alternative the value is held to ("choice" or "score")',
      },
    ]);
    expect(heldTo(union, { type: 'box' }, schemas)).toEqual([
      {
        path: '/type',
        keyword: 'enum',
        detail: '"box" names no alternative ("choice" or "score")',
      },
    ]);
    expect(heldTo(union, 5, schemas)).toEqual([
      { path: '', keyword: 'type', detail: '5 must be object' },
    ]);
  });

  it('holds a record to the alternative its discriminator maps the value to, else to the one of that name', () => {
    const schemas = {
      ...DOCUMENT_31.components.schemas,
      Box: { type: 'object', properties: { size: { type: 'number' } } },
    };
    const mapped = {
      oneOf: [
        { $ref: '#/components/schemas/Box' },
        { $ref: '#/components/schemas/Score' },
      ],
      discriminator: { propertyName: 'type', mapping: { crate: 'Box' } },
    };
    expect(
      places(heldTo(mapped, { type: 'crate', size: 'big' }, schemas)),
    ).toEqual(['/size type']);
    expect(
      places(heldTo(mapped, { type: 'score', score: 'high' }, schemas)),
    ).toEqual(['/score type']);
    expect(heldTo(mapped, { type: 'Box' }, schemas)).toEqual([
      {
        path: '/type',
        keyword: 'enum',
        detail: '"Box" names no alternative ("crate" or "score")',
      },
    ]);
    const named = {
      oneOf: [{ $ref: '#/components/schemas/Box' }],
      discriminator: { propertyName: 'type' },
    };
    expect(
      places(heldTo(named, { type: 'Box', size: 'big' }, schemas)),
    ).toEqual(['/size type']);
  });

  it('keeps required where it says what a value is: in not and in if', () => {
    const notLegacy = { type: 'object', not: { required: ['legacy'] } };
    expect(heldTo(notLegacy, {})).toEqual([]);
    expect(places(heldTo(notLegacy, { legacy: 1 }))).toEqual([' not']);
    const ifKind = {
      if: { required: ['kind'] },
      // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema's `then` keyword: its value is a schema, never a function, so nothing awaits it as a thenable
      then: { properties: { n: { type: 'number' } } },
    };
    expect(heldTo(ifKind, { n: 'x' })).toEqual([]);
    expect(places(heldTo(ifKind, { kind: 1, n: 'x' }))).toEqual(['/n type']);
  });

  it('reads a list under items as alternatives of each element where the value may be a list or null', () => {
    const listed = {
      type: ['array', 'null'],
      items: [{ type: 'string' }, { type: 'number' }],
    };
    expect(heldTo(listed, null)).toEqual([]);
    expect(heldTo(listed, ['a', 1])).toEqual([]);
    expect(places(heldTo(listed, [true]))).toEqual(['/0 type']);
  });

  it('reads nullable as "or null", beside a $ref too', () => {
    const { schemas } = DOCUMENT_31.components;
    const thing = { $ref: '#/components/schemas/Thing', nullable: true };
    expect(heldTo(thing, null, schemas)).toEqual([]);
    expect(heldTo(thing, { id: 5 }, schemas)).toEqual([
      { path: '/id', keyword: 'type', detail: '5 must be string' },
    ]);
    expect(heldTo({ type: 'string', nullable: true }, 5)).toEqual([
      { path: '', keyword: 'type', detail: '5 must be string' },
    ]);
    expect(
      places(
        heldTo(
          { $ref: '#/components/schemas/Thing', nullable: false },
          null,
          schemas,
        ),
      ),
    ).toEqual([' type']);
  });

  it('points a $ref into a schema the reading moves where it went', () => {
    const schemas = {
      Either: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      Listed: { type: 'array', items: [{ type: 'string' }] },
      Maybe: {
        type: 'object',
        nullable: true,
        properties: { name: { type: 'string' } },
      },
    };
    const to = (at: string) => ({ $ref: `#/components/schemas/${at}` });
    expect(heldTo(to('Either/oneOf/1'), 5, schemas)).toEqual([]);
    expect(places(heldTo(to('Either/oneOf/1'), 'x', schemas))).toEqual([
      ' type',
    ]);
    expect(heldTo(to('Listed/items/0'), 'x', schemas)).toEqual([]);
    expect(places(heldTo(to('Listed/items/0'), 5, schemas))).toEqual([' type']);
    expect(places(heldTo(to('Maybe/properties/name'), 5, schemas))).toEqual([
      ' type',
    ]);
    expect(
      readSchema({
        oneOf: [{ type: 'string' }],
        properties: { a: { $ref: '#/oneOf/0' } },
      }),
    ).toEqual({
      properties: { a: { $ref: '#/anyOf/0' } },
      anyOf: [{ type: 'string' }],
    });
  });
});
