import { expect, test } from 'bun:test';

import { parseDeclarationText } from './declaration-text';

const declaration = {
  schemaVersion: 1,
  name: 'north',
  origin: 'https://north.invalid',
  runtime: { revision: 'a'.repeat(40) },
  additionalOrigins: ['https://desk.partner.example'],
  sandbox: {
    backend: 'incus',
    address: { env: 'DOCKER_HOST_ADDRESS' },
    egressProxy: 'http://10.200.40.10:3128',
  },
  identity: { email: { env: 'OPERATOR_EMAIL' }, ssoEnabled: false },
};
const yaml = [
  '# a comment above the first key',
  'schemaVersion: 1',
  'name: north',
  'origin: https://north.invalid',
  'runtime:',
  `  revision: ${'a'.repeat(40)}`,
  'additionalOrigins:',
  '  - https://desk.partner.example',
  'sandbox:',
  '  backend: incus',
  '  address: { env: DOCKER_HOST_ADDRESS }',
  '  egressProxy: http://10.200.40.10:3128',
  'identity:',
  '  email: { env: OPERATOR_EMAIL }',
  '  ssoEnabled: false',
  '',
].join('\n');

test('a .json declaration is read as JSON, whatever it holds', () => {
  expect(
    parseDeclarationText(JSON.stringify(declaration), 'tale.json'),
  ).toEqual(declaration);
  expect(() => parseDeclarationText(yaml, 'tale.json')).toThrow();
  expect(() => parseDeclarationText(yaml, 'tale')).toThrow();
});

test.each(['tale.yml', 'tale.yaml', 'TALE.YML', '/opt/spec/tale.yaml'])(
  'the same declaration written as YAML in %s means what its JSON means',
  (path) => {
    expect(parseDeclarationText(yaml, path)).toEqual(declaration);
  },
);

test('YAML is YAML 1.2: a word that was a boolean in 1.1 stays a string', () => {
  expect(
    parseDeclarationText('mode: on\nanswer: yes\nflag: true\n', 'tale.yml'),
  ).toEqual({ mode: 'on', answer: 'yes', flag: true });
});

test.each([
  ['a key written twice', 'name: north\nname: south\n'],
  ['a syntax error', 'name: [north\n'],
  ['a second document', 'name: north\n---\nname: south\n'],
  ['an alias', 'base: &base\n  a: 1\ncopy: *base\n'],
])('%s is refused in fixed words that quote nothing', (_name, text) => {
  let message = '';
  try {
    parseDeclarationText(text.replace('north', 'secret-value'), 'tale.yml');
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe('Deployment declaration YAML is invalid.');
  expect(message).not.toContain('secret-value');
});
