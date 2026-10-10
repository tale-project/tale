import { describe, expect, it } from 'vitest';

import {
  fillMissingFields,
  fixableFields,
  missingRequiredFields,
  placeholderFor,
} from './fixed-input';

/** The GitHub triage pack's inputs: a schedule sends none of them. */
const GITHUB_INPUTS = {
  type: 'object',
  required: ['owner', 'repo', 'limit'],
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
    limit: { type: 'integer' },
    labels: { type: 'array' },
  },
};

describe('missingRequiredFields', () => {
  it('lists the required fields an input lacks, with their types, in schema order', () => {
    expect(
      missingRequiredFields(GITHUB_INPUTS, { trigger: 'schedule', repo: 'x' }),
    ).toEqual([
      { name: 'owner', type: 'string' },
      { name: 'limit', type: 'integer' },
    ]);
  });

  it('finds nothing missing without a schema or an object input', () => {
    expect(missingRequiredFields(undefined, {})).toEqual([]);
    expect(missingRequiredFields(GITHUB_INPUTS, 'text')).toEqual([]);
    expect(missingRequiredFields({ type: 'object' }, {})).toEqual([]);
  });

  it('gives a field with several types no single type', () => {
    expect(
      missingRequiredFields(
        { required: ['a'], properties: { a: { type: ['string', 'null'] } } },
        {},
      ),
    ).toEqual([{ name: 'a', type: undefined }]);
  });
});

describe('placeholderFor', () => {
  it.each([
    ['string', ''],
    ['number', 0],
    ['integer', 0],
    ['boolean', false],
    ['array', []],
    ['object', {}],
    [undefined, ''],
  ])('starts a %s field as %j', (type, placeholder) => {
    expect(placeholderFor(type)).toEqual(placeholder);
  });
});

describe('fixableFields', () => {
  it('leaves out the fields the trigger sets itself', () => {
    expect(
      fixableFields([
        { name: 'payload', type: 'object' },
        { name: 'owner', type: 'string' },
        { name: 'firedAt', type: 'number' },
      ]),
    ).toEqual([{ name: 'owner', type: 'string' }]);
  });
});

describe('fillMissingFields', () => {
  const OWNER_REPO_LIMIT = [
    { name: 'owner', type: 'string' },
    { name: 'repo', type: 'string' },
    { name: 'limit', type: 'integer' },
  ];

  // Ada's GitHub triage schedule sends no owner, repo or limit: one click
  // writes all three, typed, and the caret lands inside the owner's quotes.
  it('writes a typed placeholder for each field into an empty fixed input', () => {
    const filled = fillMissingFields('', OWNER_REPO_LIMIT);
    expect(filled?.text).toBe(
      '{\n  "owner": "",\n  "repo": "",\n  "limit": 0\n}',
    );
    const at = filled?.text.indexOf('"owner": "') ?? -1;
    expect(filled?.selection).toEqual({
      start: at + '"owner": "'.length,
      end: at + '"owner": "'.length,
    });
  });

  it('keeps what is there and adds only what is missing', () => {
    const filled = fillMissingFields('{"owner": "acme"}', OWNER_REPO_LIMIT);
    expect(JSON.parse(filled?.text ?? 'null')).toEqual({
      owner: 'acme',
      repo: '',
      limit: 0,
    });
  });

  it('selects a number or a boolean so typing replaces it', () => {
    const filled = fillMissingFields('{}', [
      { name: 'dryRun', type: 'boolean' },
    ]);
    const start = filled?.text.indexOf('false') ?? -1;
    expect(filled?.selection).toEqual({ start, end: start + 'false'.length });
  });

  it('puts the caret inside an array or an object', () => {
    const filled = fillMissingFields('', [{ name: 'labels', type: 'array' }]);
    const start = filled?.text.indexOf('[]') ?? -1;
    expect(filled?.selection).toEqual({ start: start + 1, end: start + 1 });
  });

  it('adds nothing to text that is no JSON object, or when nothing is missing', () => {
    expect(fillMissingFields('{"owner": ', OWNER_REPO_LIMIT)).toBeNull();
    expect(fillMissingFields('[1, 2]', OWNER_REPO_LIMIT)).toBeNull();
    expect(
      fillMissingFields('{"owner": "a"}', [{ name: 'owner', type: 'string' }]),
    ).toBeNull();
    expect(fillMissingFields('', [])).toBeNull();
  });
});
